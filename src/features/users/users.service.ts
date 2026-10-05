import type { QueryFilter } from "mongoose";
import { ApiError, type ErrorDetail } from "../../shared/errors/ApiError";
import { isPoliceOrNgo, USER_ROLES } from "../../shared/types/roles";
import { EDIT_WINDOW_MS } from "../../shared/types/verification";
import { resolvePaging, type ListQuery, type ListResult } from "../../shared/http/pagination";
import {escapeRegex, requiredField,} from "../../shared/validators/fields";
import {isEmail,isMobile,normalizeEmail,stripNonDigits,} from "../../shared/validators/validators";
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
 * The only police details a member may correct themselves: where they are
 * posted and how to reach the reporting officer.
 *
 * Everything the admin actually checks is deliberately missing - the rank,
 * badge number, station, state, employee ID, joining date, official email and
 * the ID card photo. A verified account that could swap those could replace the
 * very documents it was approved on, so a locked field is rejected by name
 * rather than quietly dropped.
 */
const SELF_EDITABLE_POLICE_FIELDS = ["district", "reporting_officer_contact"] as const;

/** The same idea for an organisation: descriptive contact details only. */
const SELF_EDITABLE_NGO_FIELDS = [
    "address",
    "city",
    "district",
    "website",
    "designation",
    "contact_email",
] as const;

/**
 * Separates what the caller may change from what only an admin may change, and
 * records an error per locked field so the form can show all of them at once.
 */
const splitProfileEdit = (
    incoming: Record<string, unknown>,
    allowed: readonly string[],
    errors: ErrorDetail,
    prefix: string,
): Record<string, unknown> => {
    const permitted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(incoming)) {
        if ((allowed as readonly string[]).includes(key)) {
            permitted[key] = value;
        } else {
            errors[`${prefix}.${key}`] =
                "This detail is checked by an admin and cannot be changed here. Ask the admin to correct it.";
        }
    }

    return permitted;
};

/**
 * Name, mobile and email - the only fields a plain citizen may change. Shared by
 * all three update endpoints; the difference between them is what happens to the
 * verification state afterwards, not this part.
 */
const applyIdentityFields = async (
    user: UserDocument,
    body: Record<string, unknown>,
    errors: ErrorDetail,
): Promise<void> => {
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
};

const throwOnErrors = (errors: ErrorDetail): void => {
    if (Object.keys(errors).length > 0) {
        throw ApiError.unprocessable("Please fix the highlighted details.", errors);
    }
};

/**
 * Sends a police or NGO member away from the plain endpoint, naming the one
 * that belongs to them. Without this the citizen endpoint would happily accept
 * a `police` block and skip the review entirely.
 */
const assertNotStaff = (user: UserDocument): void => {
    if (isPoliceOrNgo(user.role)) {
        throw ApiError.forbidden(
            user.role === "police"
                ? "Police accounts update through PATCH /api/users/me/police so the admin reviews the change."
                : "NGO accounts update through PATCH /api/users/me/ngo so the admin reviews the change.",
        );
    }
};

/**
 * The citizen endpoint: `PATCH /api/users/me`.
 *
 * A public citizen is not vetted, so there is nothing to re-approve. Name,
 * mobile and email go in and stay verified - the verification state is never
 * touched, which is what makes this different from the two staff endpoints.
 */
export const updatePublicProfile = async (user: UserDocument, body: Record<string, unknown>) => {
    assertNotStaff(user);

    const errors: ErrorDetail = {};
    await applyIdentityFields(user, body, errors);

    if (body.police !== undefined || body.ngo !== undefined) {
        errors[body.police !== undefined ? "police" : "ngo"] =
            "Only police and NGO accounts carry those details, and they are updated on their own endpoint.";
    }

    throwOnErrors(errors);

    await user.save();
    return getMe(user);
};

/**
 * The police endpoint: `PATCH /api/users/me/police`.
 *
 * Every accepted change goes back to `pending` for a fresh admin review. A
 * verified account is limited to the 6 hour window that starts at submission,
 * except a rejected account which may always fix and resubmit.
 */
export const updatePoliceProfile = async (user: UserDocument,body: Record<string, unknown>,) => {
    if (user.role !== "police") {
        throw ApiError.forbidden("This endpoint is for police accounts only.");
    }

    const errors: ErrorDetail = {};
    await applyIdentityFields(user, body, errors);

    let profileChanged = false;

    if (body.police !== undefined) {
        const endsAt = new Date((user.submitted_at?.getTime() ?? 0) + EDIT_WINDOW_MS);
        const withinWindow = endsAt.getTime() > Date.now();
        if (!withinWindow && user.verification_status === "verified") {
            throw ApiError.forbidden(
                "Your 6 hour update window has closed. Contact the admin if a correction is needed.",
            );
        }

        if (body.police && typeof body.police === "object") {
            const permitted = splitProfileEdit(
                body.police as Record<string, unknown>,
                SELF_EDITABLE_POLICE_FIELDS,
                errors,
                "police",
            );
            if (Object.keys(permitted).length > 0) {
                user.set("police", {
                    ...(plain<PoliceProfile>(user.police) ?? {}),
                    ...permitted,
                });
                profileChanged = true;
            }
        } else {
            errors.police = "Police service details must be an object.";
        }
    }

    throwOnErrors(errors);

    // Any accepted change restarts the review clock and re-queues the account,
    // so the admin has to sign off again before the portal opens again.
    if (profileChanged) {
        user.verification_status = "pending";
        user.rejection_reason = undefined;
        user.reviewed_at = undefined;
        user.reviewed_by = undefined;
        user.submitted_at = new Date();
    }

    await user.save();
    return getMe(user);
};

/**
 * The NGO endpoint: `PATCH /api/users/me/ngo`. Same review rule as police.
 */
export const updateNgoProfile = async (user: UserDocument, body: Record<string, unknown>) => {
    if (user.role !== "ngo") {
        throw ApiError.forbidden("This endpoint is for NGO accounts only.");
    }

    const errors: ErrorDetail = {};
    await applyIdentityFields(user, body, errors);

    let profileChanged = false;

    if (body.ngo !== undefined) {
        const endsAt = new Date((user.submitted_at?.getTime() ?? 0) + EDIT_WINDOW_MS);
        const withinWindow = endsAt.getTime() > Date.now();
        if (!withinWindow && user.verification_status === "verified") {
            throw ApiError.forbidden(
                "Your 6 hour update window has closed. Contact the admin if a correction is needed.",
            );
        }

        if (body.ngo && typeof body.ngo === "object") {
            const permitted = splitProfileEdit(
                body.ngo as Record<string, unknown>,
                SELF_EDITABLE_NGO_FIELDS,
                errors,
                "ngo",
            );
            if (Object.keys(permitted).length > 0) {
                user.set("ngo", { ...(plain<NgoProfile>(user.ngo) ?? {}), ...permitted });
                profileChanged = true;
            }
        } else {
            errors.ngo = "Organisation details must be an object.";
        }
    }

    throwOnErrors(errors);

    if (profileChanged) {
        user.verification_status = "pending";
        user.rejection_reason = undefined;
        user.reviewed_at = undefined;
        user.reviewed_by = undefined;
        user.submitted_at = new Date();
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
