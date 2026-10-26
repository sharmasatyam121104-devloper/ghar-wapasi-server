import { Types, type QueryFilter } from "mongoose";
import { ApiError } from "../../shared/errors/ApiError";
import { resolvePaging } from "../../shared/http/pagination";
import { listOfStrings } from "../registration/registration.shared";
import { recordAudit } from "../audit/audit.service";
import { Report } from "../reports/reports.model";
import { User, type UserDocument } from "../users/users.model";
import { assignedUserIds } from "./admin.scope";
import {
    Suspension,
    type SuspensionDocument,
    type SuspensionInterface,
    type SuspensionStatus,
} from "./suspension.model";

export interface SuspensionListResult {
    suspensions: SuspensionDocument[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

const trim = (value: unknown, max: number): string => {
    if (typeof value !== "string") return "";
    const text = value.trim();
    return text.length > max ? text.slice(0, max) : text;
};

const assertCanManageTarget = async (viewer: UserDocument, target: UserDocument): Promise<void> => {
    if (target.role === "admin" || target.role === "superadmin") {
        throw ApiError.forbidden("Administrator accounts cannot be suspended here.");
    }
    if (viewer.role === "superadmin") return;
    if (String(target.assigned_admin_id ?? "") !== String(viewer._id)) {
        throw ApiError.notFound("That account is not assigned to you.");
    }
};

/** Marks due suspensions lifted and restores the account. Called on login and list. */
export const expireDueSuspensions = async (): Promise<void> => {
    const now = new Date();
    const due = await Suspension.find({ status: "active", ends_at: { $lte: now } });
    for (const suspension of due) {
        suspension.status = "lifted";
        suspension.lifted_at = now;
        suspension.lift_note = "Lifted automatically when the suspension period ended.";
        await suspension.save();
        await User.updateOne({ _id: suspension.target_user_id }, { $set: { is_active: true } });
    }
};

/** Used by login/refresh before rejecting an inactive account. */
export const releaseExpiredSuspensionForUser = async (user: UserDocument): Promise<boolean> => {
    if (user.is_active) return true;
    const suspension = await Suspension.findOne({
        target_user_id: user._id,
        status: "active",
        ends_at: { $lte: new Date() },
    });
    if (!suspension) return false;

    suspension.status = "lifted";
    suspension.lifted_at = new Date();
    suspension.lift_note = "Lifted automatically when the suspension period ended.";
    await suspension.save();
    user.is_active = true;
    await user.save();
    return true;
};

export const createSuspension = async (
    viewer: UserDocument,
    body: Record<string, unknown>,
): Promise<SuspensionDocument> => {
    const targetId = typeof body.target_user_id === "string" ? body.target_user_id.trim() : "";
    if (!Types.ObjectId.isValid(targetId)) throw ApiError.unprocessable("Choose a valid account.");
    if (targetId === String(viewer._id)) throw ApiError.unprocessable("You cannot suspend your own account.");

    const target = await User.findById(targetId);
    if (!target) throw ApiError.notFound("That account could not be found.");
    await assertCanManageTarget(viewer, target);

    if (await Suspension.exists({ target_user_id: target._id, status: "active" })) {
        throw ApiError.conflict("That account already has an active suspension.");
    }

    const category = trim(body.category, 120);
    const reason = trim(body.reason, 2000);
    if (!category) throw ApiError.unprocessable("Choose a suspension category.");
    if (reason.length < 10) throw ApiError.unprocessable("Write a reason of at least 10 characters.");

    const durationDays = Number(body.duration_days ?? 0);
    if (!Number.isFinite(durationDays) || durationDays < 0 || durationDays > 3650) {
        throw ApiError.unprocessable("Duration must be between 0 and 3650 days.");
    }

    const reportIds = listOfStrings(body.report_ids)
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
    if (reportIds.length > 0) {
        const valid = await Report.countDocuments({
            _id: { $in: reportIds },
            target_user_id: target._id,
        });
        if (valid !== reportIds.length) {
            throw ApiError.unprocessable("One or more linked reports do not belong to this account.");
        }
    }

    const proof = listOfStrings(body.proof)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 10)
        .map((item) => item.slice(0, 300));

    const now = new Date();
    const suspension = await Suspension.create({
        target_user_id: target._id,
        target_name: `${target.first_name} ${target.last_name}`.trim(),
        target_role: target.role,
        category,
        reason,
        proof,
        report_ids: reportIds,
        suspended_at: now,
        duration_days: Math.trunc(durationDays),
        ends_at: durationDays > 0 ? new Date(now.getTime() + Math.trunc(durationDays) * 86_400_000) : undefined,
        status: "active",
        issued_by: viewer._id,
        issued_by_name: `${viewer.first_name} ${viewer.last_name}`.trim(),
    });

    target.is_active = false;
    await target.save();

    await recordAudit(viewer, {
        action: "suspension.create",
        targetType: "user",
        targetId: String(target._id),
        detail: `Suspended ${target.first_name} ${target.last_name} for ${category}.`,
    });
    return suspension;
};

const listFilter = async (
    viewer: UserDocument,
    status?: string,
): Promise<QueryFilter<SuspensionInterface>> => {
    const filter: QueryFilter<SuspensionInterface> = {};
    if (viewer.role === "admin") {
        filter.target_user_id = { $in: await assignedUserIds(viewer) };
    }
    if (status === "active" || status === "lifted") filter.status = status as SuspensionStatus;
    return filter;
};

export const listSuspensions = async (
    viewer: UserDocument,
    query: { page?: number; limit?: number; status?: string } = {},
): Promise<SuspensionListResult> => {
    await expireDueSuspensions();
    const filter = await listFilter(viewer, query.status);
    const { page, limit } = resolvePaging({ page: query.page, limit: query.limit });
    const [suspensions, total] = await Promise.all([
        Suspension.find(filter).sort({ suspended_at: -1 }).skip((page - 1) * limit).limit(limit),
        Suspension.countDocuments(filter),
    ]);
    return { suspensions, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
};

export const getScopedSuspension = async (
    viewer: UserDocument,
    id: string,
): Promise<SuspensionDocument> => {
    if (!Types.ObjectId.isValid(id)) throw ApiError.notFound("That suspension could not be found.");
    const suspension = await Suspension.findById(id);
    if (!suspension) throw ApiError.notFound("That suspension could not be found.");

    if (viewer.role !== "superadmin") {
        const target = await User.findById(suspension.target_user_id).select("assigned_admin_id");
        if (!target || String(target.assigned_admin_id ?? "") !== String(viewer._id)) {
            throw ApiError.notFound("That suspension could not be found.");
        }
    }
    return suspension;
};

export const liftSuspension = async (
    viewer: UserDocument,
    id: string,
    body: Record<string, unknown>,
): Promise<SuspensionDocument> => {
    const suspension = await getScopedSuspension(viewer, id);
    if (suspension.status !== "active") throw ApiError.unprocessable("This suspension is already lifted.");

    const note = trim(body.note, 1000);
    suspension.status = "lifted";
    suspension.lifted_at = new Date();
    suspension.lift_note = note || "Lifted by an administrator.";
    await suspension.save();

    await User.updateOne(
        { _id: suspension.target_user_id, role: { $nin: ["admin", "superadmin"] } },
        { $set: { is_active: true } },
    );

    await recordAudit(viewer, {
        action: "suspension.lift",
        targetType: "user",
        targetId: String(suspension.target_user_id),
        detail: `Lifted suspension for ${suspension.target_name}.`,
    });
    return suspension;
};
