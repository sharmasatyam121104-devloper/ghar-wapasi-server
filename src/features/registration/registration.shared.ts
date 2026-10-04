import type { QueryFilter } from "mongoose";
import { Types } from "mongoose";
import { ApiError, type ErrorDetail } from "../../shared/errors/ApiError";
import { hashRefreshToken, issueTokens, type AuthTokens } from "../../shared/tokens/jwt";
import { requiredField } from "../../shared/validators/fields";
import {
    isAadhaar,
    isEmail,
    isMobile,
    isStrongEnough,
    normalizeEmail,
    stripNonDigits,
} from "../../shared/validators/validators";
import { User, type UserDocument } from "../users/users.model";
import type { PublicUser, UserInterface } from "../users/users.types";

/**
 * What every role's registration service shares: the identity fields, the
 * duplicate check, and starting the session. Anything role-specific lives in
 * that role's own service file next door, so `admin` rules never sit in the
 * middle of the police path.
 *
 * No file here takes a `role` argument. The role is a literal inside the
 * service that owns it, which is what makes it impossible for a request to
 * talk its way into the wrong account type.
 */

export interface RegisterResult {
    user: PublicUser;
    tokens: AuthTokens;
}

/** The identity fields, cleaned up and ready to store. */
export interface NormalizedRegistration {
    first_name: string;
    last_name: string;
    aadhaar: string;
    mobile: string;
    email: string;
    /** Only ever returned once it has passed `isStrongEnough`. */
    password: string;
}

/** Which parts of the identity a given role insists on. */
export interface IdentityRules {
    /** Police, NGO and admin accounts are unreachable without an email. */
    requireEmail: boolean;
    /** Shown in the "email is required" error, so it names the right account type. */
    emailHint: string;
}

/**
 * Fills `errors` in place and returns the cleaned identity fields.
 * A non-empty `errors` object means the sign-up must not be saved.
 */
export const validateIdentity = (
    body: Record<string, unknown>,
    rules: IdentityRules,
    errors: ErrorDetail,
): NormalizedRegistration => {
    const firstName = requiredField(body.first_name, "first_name", errors);
    const lastName = requiredField(body.last_name, "last_name", errors);

    const aadhaarRaw = requiredField(body.aadhaar, "aadhaar", errors);
    if (aadhaarRaw && !isAadhaar(aadhaarRaw)) {
        errors.aadhaar = "Enter a valid 12-digit Aadhaar number.";
    }

    const mobileRaw = requiredField(body.mobile, "mobile", errors);
    if (mobileRaw && !isMobile(mobileRaw)) {
        errors.mobile = "Enter a valid 10-digit mobile number.";
    }

    // The public sign-up form does not collect an email; the staff forms do.
    const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
    if (emailRaw && !isEmail(emailRaw)) {
        errors.email = "Enter a valid email address.";
    } else if (!emailRaw && rules.requireEmail) {
        errors.email = rules.emailHint;
    }

    const password = typeof body.password === "string" ? body.password : "";
    if (!password) {
        errors.password = "Password is required.";
    } else if (!isStrongEnough(password)) {
        errors.password = "Password must be at least 6 characters.";
    }

    return {
        first_name: firstName,
        last_name: lastName,
        aadhaar: stripNonDigits(aadhaarRaw),
        mobile: stripNonDigits(mobileRaw),
        email: emailRaw ? normalizeEmail(emailRaw) : "",
        password,
    };
};

/**
 * The columns to hand `User.create`, shared by every role.
 *
 * `email` is omitted rather than stored blank when it was not collected: the
 * index on it is `sparse`, and a sparse index still indexes an empty string,
 * so writing `""` would cap the whole site at one email-less account.
 */
export const identityFields = (identity: NormalizedRegistration) => ({
    first_name: identity.first_name,
    last_name: identity.last_name,
    aadhaar: identity.aadhaar,
    mobile: identity.mobile,
    ...(identity.email ? { email: identity.email } : {}),
    password: identity.password,
});

/** Turns a filled-in `errors` object into the 422 the client expects. */
export const assertNoFieldErrors = (errors: ErrorDetail): void => {
    if (Object.keys(errors).length > 0) {
        throw ApiError.unprocessable("Please fix the highlighted details.", errors);
    }
};

/**
 * Rejects a second account with the same Aadhaar, mobile or email before the
 * write happens, so the client gets a readable 409 instead of a raw Mongo
 * duplicate-key failure.
 */
export const assertIdentifiersAreFree = async (
    aadhaar: string,
    mobile: string,
    email: string,
): Promise<void> => {
    const clashes: QueryFilter<UserInterface>[] = [{ aadhaar }, { mobile }];
    if (email) clashes.push({ email });

    const existing = await User.find({ $or: clashes }).select("email aadhaar mobile").lean();
    if (existing.length === 0) return;

    const errors: ErrorDetail = {};
    if (existing.some((row) => row.aadhaar === aadhaar)) {
        errors.aadhaar = "This Aadhaar number is already registered.";
    }
    if (existing.some((row) => row.mobile === mobile)) {
        errors.mobile = "This mobile number is already registered.";
    }
    if (email && existing.some((row) => row.email === email)) {
        errors.email = "This email is already registered.";
    }

    throw ApiError.conflict("An account with these details already exists.", errors);
};

/**
 * Issues the access/refresh pair and remembers the refresh hash, so the
 * returned refresh token is the only one that will ever work for this account.
 */
export const openSession = async (user: UserDocument): Promise<AuthTokens> => {
    const tokens = issueTokens({ _id: String(user._id), role: user.role, email: user.email });
    user.refresh_token_hash = hashRefreshToken(tokens.refreshToken);
    user.last_login = new Date();
    await user.save();
    return tokens;
};

/**
 * Mirrors the frontend's `pickAdminForMember`: prefer an admin in the same
 * state, then the least loaded, then the oldest account. Deterministic, so
 * the same registration always lands with the same reviewer.
 *
 * Returns undefined when the site has no admin yet. The review queue is scoped
 * by `assigned_admin_id`, so such a request sits outside every queue until an
 * admin exists - see the zero-admin note in the README.
 */
export const pickAdminForMember = async (state?: string): Promise<Types.ObjectId | undefined> => {
    const admins = await User.find({ role: "admin", is_active: true })
        .select("_id first_name last_name email created_at police.state ngo.state")
        .lean();

    if (admins.length === 0) return undefined;

    const stateOf = (admin: (typeof admins)[number]): string =>
        (admin.ngo?.state ?? admin.police?.state ?? "").trim();

    const sameState = state ? admins.filter((admin) => stateOf(admin) === state) : [];
    const pool = sameState.length > 0 ? sameState : admins;

    const ranked = await Promise.all(
        pool.map(async (admin) => ({
            id: admin._id as Types.ObjectId,
            createdAt: admin.created_at as Date | undefined,
            pending: await User.countDocuments({
                role: { $in: ["police", "ngo"] },
                verification_status: "pending",
                assigned_admin_id: admin._id,
            }),
        })),
    );

    ranked.sort((a, b) => {
        if (a.pending !== b.pending) return a.pending - b.pending;
        const aTime = a.createdAt?.getTime() ?? 0;
        const bTime = b.createdAt?.getTime() ?? 0;
        if (aTime !== bTime) return aTime - bTime;
        return String(a.id).localeCompare(String(b.id));
    });

    return ranked[0]?.id;
};
