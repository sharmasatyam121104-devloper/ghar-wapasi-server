import type { QueryFilter } from "mongoose";
import { ApiError, type ErrorDetail } from "../../shared/errors/ApiError";
import { isPoliceOrNgo, USER_ROLES } from "../../shared/types/roles";
import { EDIT_WINDOW_MS } from "../../shared/types/verification";
import { resolvePaging, type ListQuery, type ListResult } from "../../shared/http/pagination";
import {escapeRegex, requiredField,} from "../../shared/validators/fields";
import {isEmail,isMobile,normalizeEmail,stripNonDigits,} from "../../shared/validators/validators";
import { User, type UserDocument } from "./users.model";
import { plain, toPublicUser } from "./users.serializers";
import type {
    NgoProfile,
    PendingContactChange,
    PoliceProfile,
    PublicUser,
    UserInterface,
} from "./users.types";
import { consumeReceipt } from "../otp/otp.service";

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
        // What the member asked to change, so the form can show "waiting for an
        // admin" against the new contact instead of the one still in force.
        pending_contact: plain<PendingContactChange>(user.pending_contact) ?? null,
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
 * Name only. Never gated by a code: a person can spell their own name.
 */
/**
 * Applies `first_name` and `last_name` if present, and reports whether anything
 * was actually applied.
 *
 * The return value is what decides whether a police or NGO account goes back for
 * review, so it counts a name that was sent rather than one that differs - a
 * client that resubmits a whole form should re-queue just as it does for a
 * profile field. An absent or blank name is an error, not a silent skip, so the
 * report can only be `true` for a value that will be saved.
 */
const applyNames = (
    user: UserDocument,
    body: Record<string, unknown>,
    errors: ErrorDetail,
): boolean => {
    let applied = false;

    if (body.first_name !== undefined) {
        const value = requiredField(body.first_name, "first_name", errors);
        if (value) {
            user.first_name = value;
            applied = true;
        }
    }

    if (body.last_name !== undefined) {
        const value = requiredField(body.last_name, "last_name", errors);
        if (value) {
            user.last_name = value;
            applied = true;
        }
    }

    return applied;
};
/** A contact change that has been proved with a code, plus when it was proved. */
interface ContactChange {
    email?: string;
    mobile?: string;
    emailVerifiedAt?: Date;
    mobileVerifiedAt?: Date;
}

/**
 * Picks the receipt for one contact field.
 *
 * `email_otp_token` / `mobile_otp_token` are always unambiguous. The plain
 * `otp_token` is accepted as a convenience when exactly one contact field is
 * changing in the request - which is the normal case - and ignored when both are,
 * because then it would be guesswork.
 */
const receiptFor = (body: Record<string, unknown>, field: "email" | "mobile"): unknown => {
    const perField = body[`${field}_otp_token`];
    if (perField !== undefined) return perField;

    const changing = (body.email !== undefined ? 1 : 0) + (body.mobile !== undefined ? 1 : 0);
    return changing === 1 ? body.otp_token : undefined;
};

/** Already used by somebody else - checked again at approval time as well. */
const contactTaken = async (
    user: UserDocument,
    filter: { email?: string; mobile?: string },
): Promise<boolean> => {
    const taken = await User.findOne({ ...filter, _id: { $ne: user._id } })
        .select("_id")
        .lean();
    return Boolean(taken);
};

/**
 * Validates the requested contact change *before* any receipt is spent.
 *
 * The order matters: consuming a receipt is irreversible, so every format and
 * availability error is collected first and thrown together. By the time a code
 * is burned the request is known to be otherwise sound.
 */
const validateContactChange = async (
    user: UserDocument,
    body: Record<string, unknown>,
    errors: ErrorDetail,
): Promise<{ email?: string; mobile?: string }> => {
    const wanted: { email?: string; mobile?: string } = {};

    if (body.email !== undefined) {
        const email = normalizeEmail(String(body.email));
        if (!isEmail(email)) errors.email = "Enter a valid email address.";
        else if (email === user.email) errors.email = "That is already the email address on your account.";
        else if (await contactTaken(user, { email })) {
            errors.email = "This email is already registered.";
        } else {
            wanted.email = email;
        }
    }

    if (body.mobile !== undefined) {
        const mobile = stripNonDigits(String(body.mobile));
        if (!isMobile(mobile)) errors.mobile = "Enter a valid 10-digit mobile number.";
        else if (mobile === user.mobile) errors.mobile = "That is already the mobile number on your account.";
        else if (await contactTaken(user, { mobile })) {
            errors.mobile = "This mobile number is already registered.";
        } else {
            wanted.mobile = mobile;
        }
    }

    return wanted;
};

/**
 * Spends the receipts for a validated contact change.
 *
 * This is the gate the whole feature exists for: a body may claim anything, but
 * `otp_token` is only accepted when it matches a live, unconsumed, unexpired
 * challenge belonging to this caller, issued for this purpose, sent to this
 * exact destination.
 */
const proveContactChange = async (
    user: UserDocument,
    body: Record<string, unknown>,
    wanted: { email?: string; mobile?: string },
): Promise<ContactChange> => {
    const change: ContactChange = {};

    if (wanted.email) {
        const receipt = await consumeReceipt(user, receiptFor(body, "email"), {
            purpose: "PROFILE_EMAIL_CHANGE",
            target: wanted.email,
        });
        change.email = wanted.email;
        change.emailVerifiedAt = receipt.verified_at;
    }

    if (wanted.mobile) {
        const receipt = await consumeReceipt(user, receiptFor(body, "mobile"), {
            purpose: "PROFILE_MOBILE_CHANGE",
            target: wanted.mobile,
        });
        change.mobile = wanted.mobile;
        change.mobileVerifiedAt = receipt.verified_at;
    }

    return change;
};

/**
 * Stages a proved contact change for an admin instead of applying it.
 *
 * The live `email`/`mobile` are left alone on purpose: if the admin rejects the
 * request nothing should have changed, and the old contact keeps working until
 * they approve.
 */
const stageContactChange = (user: UserDocument, change: ContactChange): void => {
    const existing = plain<PendingContactChange>(user.pending_contact) ?? {};

    user.set("pending_contact", {
        email: change.email ?? existing.email,
        mobile: change.mobile ?? existing.mobile,
        email_otp_verified_at: change.emailVerifiedAt ?? existing.email_otp_verified_at,
        mobile_otp_verified_at: change.mobileVerifiedAt ?? existing.mobile_otp_verified_at,
        requested_at: new Date(),
    });
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
 * The 6 hour self-service window, shared by every change that goes back for
 * review - a name, a profile field or a contact.
 *
 * Only enforced for a `verified` account. A pending or rejected one can always
 * fix and resubmit, which is the whole point of leaving it in that state.
 */
const assertInsideEditWindow = (user: UserDocument): void => {
    if (user.verification_status !== "verified") return;

    const endsAt = new Date((user.submitted_at?.getTime() ?? 0) + EDIT_WINDOW_MS);
    if (endsAt.getTime() <= Date.now()) {
        throw ApiError.forbidden(
            "Your 6 hour update window has closed. Contact the admin if a correction is needed.",
        );
    }
};

/**
 * The citizen endpoint: `PATCH /api/users/me`.
 *
 * A public citizen is not vetted, so there is nothing to re-approve. A name goes
 * in directly. A new email or mobile has to be proved with a code first, and
 * once the code is accepted the change lands immediately - the account stays
 * verified, because a public account was never on hold in the first place.
 */
export const updatePublicProfile = async (user: UserDocument, body: Record<string, unknown>) => {
    assertNotStaff(user);

    const errors: ErrorDetail = {};
    applyNames(user, body, errors);

    if (body.police !== undefined || body.ngo !== undefined) {
        errors[body.police !== undefined ? "police" : "ngo"] =
            "Only police and NGO accounts carry those details, and they are updated on their own endpoint.";
    }

    const wanted = await validateContactChange(user, body, errors);
    throwOnErrors(errors);

    // Codes are only spent once the request is known to be otherwise valid.
    const change = await proveContactChange(user, body, wanted);

    if (change.email) user.email = change.email;
    if (change.mobile) user.mobile = change.mobile;

    await user.save();
    return getMe(user);
};

/**
 * The police endpoint: `PATCH /api/users/me/police`.
 *
 * Every accepted change goes back to `pending` for a fresh admin review - a name
 * exactly like a profile field, since a member's name is part of what an admin
 * vets. A verified account is limited to the 6 hour window that starts at
 * submission, except a rejected account which may always fix and resubmit.
 *
 * A new email or mobile needs a code *and* an admin. The code proves the member
 * controls the destination; the approval is what actually changes the account,
 * because a police or NGO contact is part of what an admin vets.
 */
export const updatePoliceProfile = async (user: UserDocument,body: Record<string, unknown>,) => {
    if (user.role !== "police") {
        throw ApiError.forbidden("This endpoint is for police accounts only.");
    }

    // A name goes back for review too, so it has to sit inside the same window a
    // profile field does - otherwise a verified officer could rename themselves
    // after hours and knock their own account out of verified.
    const wantsReview =
        body.first_name !== undefined ||
        body.last_name !== undefined ||
        body.police !== undefined;
    if (wantsReview) {
        assertInsideEditWindow(user);
    }

    const errors: ErrorDetail = {};
    let profileChanged = applyNames(user, body, errors);

    const wanted = await validateContactChange(user, body, errors);

    if (body.police !== undefined) {
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

    const change = await proveContactChange(user, body, wanted);
    if (change.email || change.mobile) {
        // Held, not applied: `approveUser` promotes these and `rejectUser`
        // discards them, so the live contact is untouched either way.
        stageContactChange(user, change);
        profileChanged = true;
    }

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
 * The NGO endpoint: `PATCH /api/users/me/ngo`. Same review rule as police, and a
 * name is reviewed the same way a profile field is.
 */
export const updateNgoProfile = async (user: UserDocument, body: Record<string, unknown>) => {
    if (user.role !== "ngo") {
        throw ApiError.forbidden("This endpoint is for NGO accounts only.");
    }

    const wantsReview =
        body.first_name !== undefined ||
        body.last_name !== undefined ||
        body.ngo !== undefined;
    if (wantsReview) {
        assertInsideEditWindow(user);
    }

    const errors: ErrorDetail = {};
    let profileChanged = applyNames(user, body, errors);

    const wanted = await validateContactChange(user, body, errors);

    if (body.ngo !== undefined) {
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

    const change = await proveContactChange(user, body, wanted);
    if (change.email || change.mobile) {
        stageContactChange(user, change);
        profileChanged = true;
    }

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
