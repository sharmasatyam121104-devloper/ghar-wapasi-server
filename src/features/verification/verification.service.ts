import type { QueryFilter } from "mongoose";
import { Types } from "mongoose";
import { ApiError } from "../../shared/errors/ApiError";
import { resolvePaging, type ListQuery, type ListResult } from "../../shared/http/pagination";
import { isPoliceOrNgo } from "../../shared/types/roles";
import { escapeRegex } from "../../shared/validators/fields";
import { isHttpUrl } from "../../shared/validators/validators";
import { User, type UserDocument } from "../users/users.model";
import {
    toVerificationRecord,
    type VerificationRecord,
} from "../users/users.serializers";
import type { UserInterface } from "../users/users.types";

const REJECTION_REASON_MIN = 10;
const CALL_NOTE_MAX = 500;

export interface ScheduleCallInput {
    link?: string;
    time?: string;
    note?: string;
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

const getStaffUser = async (id: string): Promise<UserDocument> => {
    if (!Types.ObjectId.isValid(id)) {
        throw ApiError.notFound("That verification request could not be found.");
    }
    const user = await User.findById(id);
    if (!user) throw ApiError.notFound("That verification request could not be found.");
    if (!isPoliceOrNgo(user.role)) {
        throw ApiError.badRequest("Only police and NGO accounts go through verification.");
    }
    return user;
};

/**
 * Scoping guard. The frontend does the same check, but the client is not a
 * security boundary - an admin must never see or touch another admin's queue.
 */
const assertAssignedTo = (user: UserDocument, adminId: string): void => {
    if (!user.assigned_admin_id || String(user.assigned_admin_id) !== adminId) {
        throw ApiError.notFound("That verification request could not be found.");
    }
};

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

export const listVerificationRequests = async (
    adminId: string,
    query: ListQuery = {},
): Promise<ListResult<VerificationRecord>> => {
    const filter: QueryFilter<UserInterface> = {
        role: { $in: ["police", "ngo"] },
        assigned_admin_id: adminId,
    };

    if (query.verificationStatus) filter.verification_status = query.verificationStatus;

    if (query.search?.trim()) {
        const safe = escapeRegex(query.search.trim());
        filter.$or = [
            { first_name: new RegExp(safe, "i") },
            { last_name: new RegExp(safe, "i") },
            { email: new RegExp(safe, "i") },
            { mobile: new RegExp(safe, "i") },
            { "police.station_name": new RegExp(safe, "i") },
            { "ngo.org_name": new RegExp(safe, "i") },
        ];
    }

    const { page, limit } = resolvePaging(query);

    const [users, total] = await Promise.all([
        User.find(filter).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit),
        User.countDocuments(filter),
    ]);

    return {
        users: users.map(toVerificationRecord),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
    };
};

export const getVerificationRequest = async (
    adminId: string,
    userId: string,
): Promise<VerificationRecord> => {
    const user = await getStaffUser(userId);
    assertAssignedTo(user, adminId);
    return toVerificationRecord(user);
};

/* ------------------------------------------------------------------ */
/* Scheduling the verification call                                    */
/* ------------------------------------------------------------------ */

/**
 * The admin owns the meeting link and the time. Validation mirrors the
 * frontend exactly: an http/https link, a readable date, and a future moment.
 */
export const scheduleCall = async (
    adminId: string,
    userId: string,
    input: ScheduleCallInput,
): Promise<VerificationRecord> => {
    const user = await getStaffUser(userId);
    assertAssignedTo(user, adminId);

    const link = typeof input.link === "string" ? input.link.trim() : "";
    if (!link) {
        throw ApiError.badRequest("You have to give the meeting link yourself.");
    }
    if (!isHttpUrl(link)) {
        throw ApiError.badRequest("Meeting link must start with http:// or https://");
    }

    const when = input.time ? new Date(input.time) : null;
    if (!when || Number.isNaN(when.getTime())) {
        throw ApiError.badRequest("That date and time could not be read.");
    }
    if (when.getTime() < Date.now()) {
        throw ApiError.badRequest("Pick a future date and time for the call.");
    }

    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (note.length > CALL_NOTE_MAX) {
        throw ApiError.badRequest(`The note must be ${CALL_NOTE_MAX} characters or fewer.`);
    }

    user.verification_call = {
        link,
        time: when,
        note: note || undefined,
        scheduled_by: adminId as unknown as Types.ObjectId,
        scheduled_at: new Date(),
    };
    await user.save();

    return toVerificationRecord(user);
};

export const clearCall = async (adminId: string, userId: string): Promise<VerificationRecord> => {
    const user = await getStaffUser(userId);
    assertAssignedTo(user, adminId);
    if (!user.verification_call?.link) {
        throw ApiError.conflict("There is no scheduled call to clear.");
    }
    user.verification_call = undefined;
    await user.save();
    return toVerificationRecord(user);
};

/* ------------------------------------------------------------------ */
/* Decision                                                            */
/* ------------------------------------------------------------------ */

/**
 * Approval is blocked until the admin has supplied BOTH a link and a time.
 * This is the server-side half of the frontend's `approvalBlockReason`.
 */
export const approveUser = async (adminId: string, userId: string): Promise<VerificationRecord> => {
    const user = await getStaffUser(userId);
    assertAssignedTo(user, adminId);

    if (user.verification_status === "verified") {
        throw ApiError.conflict("This account is already verified.");
    }

    const call = user.verification_call;
    if (!call?.link || !call?.time) {
        throw ApiError.unprocessable(
            "Give the meeting link and time first - the user never picks their own slot.",
        );
    }

    user.verification_status = "verified";
    user.rejection_reason = undefined;
    user.reviewed_by = adminId as unknown as Types.ObjectId;
    user.reviewed_at = new Date();
    await user.save();

    return toVerificationRecord(user);
};

export const rejectUser = async (
    adminId: string,
    userId: string,
    reason: unknown,
): Promise<VerificationRecord> => {
    const user = await getStaffUser(userId);
    assertAssignedTo(user, adminId);

    const text = typeof reason === "string" ? reason.trim() : "";
    if (text.length < REJECTION_REASON_MIN) {
        throw ApiError.unprocessable(
            `Please give a reason of at least ${REJECTION_REASON_MIN} characters.`,
            { reason: `Must be at least ${REJECTION_REASON_MIN} characters.` },
        );
    }

    // Rejection deliberately does not require a scheduled call.
    user.verification_status = "rejected";
    user.rejection_reason = text;
    user.reviewed_by = adminId as unknown as Types.ObjectId;
    user.reviewed_at = new Date();
    await user.save();

    return toVerificationRecord(user);
};
