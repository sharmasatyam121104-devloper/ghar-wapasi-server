import type { QueryFilter } from "mongoose";
import { ApiError, type ErrorDetail } from "../../shared/errors/ApiError";
import { isPoliceOrNgo, USER_ROLES } from "../../shared/types/roles";
import { EDIT_WINDOW_MS } from "../../shared/types/verification";
import { resolvePaging, type ListQuery, type ListResult } from "../../shared/http/pagination";
import {
    escapeRegex,
    requiredField,
} from "../../shared/validators/fields";
import {
    isEmail,
    isMobile,
    normalizeEmail,
    stripNonDigits,
} from "../../shared/validators/validators";
import { User, type UserDocument } from "./users.model";
import { plain, toPublicUser } from "./users.serializers";
import type { NgoProfile, PoliceProfile, PublicUser, UserInterface } from "./users.types";

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export const getById = async (id: string): Promise<UserDocument> => {
    const user = await User.findById(id);
    if (!user) throw ApiError.notFound("That account could not be found.");
    return user;
};

/**
 * The caller's own view of themselves. Police and NGO accounts additionally
 * get their review state plus `can_edit`, which drives the frontend's
 * "you may still fix your details" countdown.
 */
export const getMe = (user: UserDocument) => {
    const result: Record<string, unknown> = {
        user: toPublicUser(user),
        police: plain<PoliceProfile>(user.police) ?? null,
        ngo: plain<NgoProfile>(user.ngo) ?? null,
        verification_call: user.verification_call
            ? {
                  link: user.verification_call.link,
                  time: user.verification_call.time,
                  note: user.verification_call.note,
              }
            : null,
        last_login: user.last_login ?? null,
        created_at: user.created_at,
    };

    if (isPoliceOrNgo(user.role)) {
        const endsAt = user.submitted_at
            ? new Date(user.submitted_at.getTime() + EDIT_WINDOW_MS)
            : null;
        result.verification_status = user.verification_status;
        result.rejection_reason = user.rejection_reason ?? null;
        result.submitted_at = user.submitted_at ?? null;
        result.update_window_ends_at = endsAt;
        // A rejected account may always fix and resubmit; a verified one is
        // locked to its 6 hour window, mirroring the frontend countdown.
        result.can_edit =
            Boolean(endsAt && endsAt.getTime() > Date.now()) ||
            user.verification_status !== "verified";
    }

    return result;
};

/* ------------------------------------------------------------------ */
/* Self-service update                                                 */
/* ------------------------------------------------------------------ */

/**
 * Police and NGO accounts are limited to the 6 hour window that starts at
 * submission, except a rejected account which may always fix and resubmit.
 */
export const updateMe = async (user: UserDocument, body: Record<string, unknown>) => {
    const errors: ErrorDetail = {};

    if (body.first_name !== undefined) {
        const value = requiredField(body.first_name, "first_name", errors);
        if (value) user.first_name = value;
    }
    if (body.last_name !== undefined) {
        const value = requiredField(body.last_name, "last_name", errors);
        if (value) user.last_name = value;
    }

    if (body.mobile !== undefined) {
        const mobile = stripNonDigits(String(body.mobile));
        if (!isMobile(mobile)) {
            errors.mobile = "Enter a valid 10-digit mobile number.";
        } else {
            const taken = await User.findOne({ mobile, _id: { $ne: user._id } })
                .select("_id")
                .lean();
            if (taken) errors.mobile = "This mobile number is already registered.";
            else user.mobile = mobile;
        }
    }

    if (body.email !== undefined) {
        const email = normalizeEmail(String(body.email));
        if (!isEmail(email)) {
            errors.email = "Enter a valid email address.";
        } else {
            const taken = await User.findOne({ email, _id: { $ne: user._id } })
                .select("_id")
                .lean();
            if (taken) errors.email = "This email is already registered.";
            else user.email = email;
        }
    }

    const wantsProfileEdit =
        (body.police !== undefined && user.role === "police") ||
        (body.ngo !== undefined && user.role === "ngo");

    if (wantsProfileEdit) {
        const endsAt = new Date((user.submitted_at?.getTime() ?? 0) + EDIT_WINDOW_MS);
        const withinWindow = endsAt.getTime() > Date.now();
        if (!withinWindow && user.verification_status === "verified") {
            throw ApiError.forbidden(
                "Your 6 hour update window has closed. Contact the admin if a correction is needed.",
            );
        }

        if (body.police !== undefined && user.role === "police") {
            const incoming = body.police as PoliceProfile;
            if (incoming && typeof incoming === "object") {
                user.set("police", { ...(plain<PoliceProfile>(user.police) ?? {}), ...incoming });
            } else {
                errors.police = "Police service details must be an object.";
            }
        }

        if (body.ngo !== undefined && user.role === "ngo") {
            const incoming = body.ngo as NgoProfile;
            if (incoming && typeof incoming === "object") {
                user.set("ngo", { ...(plain<NgoProfile>(user.ngo) ?? {}), ...incoming });
            } else {
                errors.ngo = "Organisation details must be an object.";
            }
        }

        // Any profile edit restarts the review clock and re-queues the account.
        user.verification_status = "pending";
        user.rejection_reason = undefined;
        user.reviewed_at = undefined;
        user.reviewed_by = undefined;
        user.submitted_at = new Date();
    }

    if (Object.keys(errors).length > 0) {
        throw ApiError.unprocessable("Please fix the highlighted details.", errors);
    }

    await user.save();
    return getMe(user);
};

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

export const listUsers = async (query: ListQuery = {}): Promise<ListResult<PublicUser>> => {
    const filter: QueryFilter<UserInterface> = {};

    if (query.role && USER_ROLES.includes(query.role)) filter.role = query.role;
    if (query.verificationStatus) filter.verification_status = query.verificationStatus;

    if (query.search?.trim()) {
        const safe = escapeRegex(query.search.trim());
        filter.$or = [
            { first_name: new RegExp(safe, "i") },
            { last_name: new RegExp(safe, "i") },
            { email: new RegExp(safe, "i") },
            { mobile: new RegExp(safe, "i") },
            { aadhaar: new RegExp(safe, "i") },
        ];
    }

    const { page, limit } = resolvePaging(query);

    const [users, total] = await Promise.all([
        User.find(filter).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit),
        User.countDocuments(filter),
    ]);

    return {
        users: users.map(toPublicUser),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
    };
};
