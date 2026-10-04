import type { QueryFilter } from "mongoose";
import bcrypt from "bcryptjs";
import { ApiError } from "../../shared/errors/ApiError";
import {
    hashRefreshToken,
    issueTokens,
    verifyRefreshToken,
    type AuthTokens,
} from "../../shared/tokens/jwt";
import { isPoliceOrNgo } from "../../shared/types/roles";
import { EDIT_WINDOW_MS } from "../../shared/types/verification";
import {
    isAadhaar,
    isEmail,
    isMobile,
    normalizeEmail,
    stripNonDigits,
} from "../../shared/validators/validators";
import { User } from "../users/users.model";
import { toPublicUser } from "../users/users.serializers";
import type { PublicUser, UserInterface } from "../users/users.types";

export interface LoginResult {
    user: PublicUser;
    tokens: AuthTokens;
    pendingVerification: boolean;
    rejectionReason?: string;
    updateWindowEndsAt?: Date;
}

/** Digits, spaces, hyphens and an optional `+` - the shapes a number gets typed in. */
const NUMBER_INPUT = /^\+?[\d\s-]+$/;

/**
 * Drops an explicit `+91` country code. Only the `+` form is stripped: a bare
 * leading `91` is left alone, because those two digits may be the start of a
 * 12-digit Aadhaar.
 */
const nationalNumber = (value: string): string => stripNonDigits(value.replace(/^\+\s*91/, ""));

/**
 * Turns whatever the login field holds into the stored field it could mean:
 * an email, a 12-digit Aadhaar or a 10-digit mobile. A value matching no shape
 * is rejected outright, so a typo gets a readable 400 instead of the generic
 * "email or password is incorrect".
 *
 * Mobile is here because a public account registers without an email, and
 * `toPublicUser` hands it back its mobile as `identifier` - that value has to
 * be able to sign in.
 */
const identifierQuery = (raw: unknown): QueryFilter<UserInterface> => {
    const invalid = (): ApiError =>
        ApiError.badRequest(
            "Enter a valid email address, 12-digit Aadhaar number or 10-digit mobile number.",
        );

    if (typeof raw !== "string" || !raw.trim()) throw invalid();

    const value = raw.trim();

    // The "@" is what separates the two worlds: without it, an email such as
    // `123456789012@x.com` would be read as a 12-digit Aadhaar.
    if (value.includes("@")) {
        if (!isEmail(value)) throw invalid();
        return { email: normalizeEmail(value) };
    }

    if (!NUMBER_INPUT.test(value)) throw invalid();

    const digits = nationalNumber(value);
    if (isAadhaar(digits)) return { aadhaar: digits };
    if (isMobile(digits)) return { mobile: digits };
    throw invalid();
};

/**
 * Accepts an email, a 12-digit Aadhaar number or a 10-digit mobile number,
 * exactly like the frontend's single login field. The role is always read from
 * the stored record, never from the request body.
 */
export const login = async (identifier: unknown, password: unknown): Promise<LoginResult> => {
    const query = identifierQuery(identifier);

    if (typeof password !== "string" || !password) {
        throw ApiError.badRequest("Password is required.");
    }

    const user = await User.findOne(query).select("+password");
    if (!user) {
        // Identical message for unknown user and wrong password, so the
        // endpoint cannot be used to enumerate registered accounts.
        throw ApiError.unauthorized("Email or password is incorrect.");
    }

    const matches = await bcrypt.compare(password, user.password);
    if (!matches) {
        throw ApiError.unauthorized("Email or password is incorrect.");
    }

    if (!user.is_active) {
        throw ApiError.forbidden("This account has been deactivated. Contact the admin.");
    }

    const tokens = issueTokens({ _id: String(user._id), role: user.role, email: user.email });
    user.refresh_token_hash = hashRefreshToken(tokens.refreshToken);
    user.last_login = new Date();
    await user.save();

    const result: LoginResult = {
        user: toPublicUser(user),
        tokens,
        pendingVerification: isPoliceOrNgo(user.role) && user.verification_status !== "verified",
    };

    if (user.rejection_reason) result.rejectionReason = user.rejection_reason;
    if (isPoliceOrNgo(user.role) && user.submitted_at) {
        const endsAt = new Date(user.submitted_at.getTime() + EDIT_WINDOW_MS);
        if (endsAt.getTime() > Date.now()) result.updateWindowEndsAt = endsAt;
    }

    return result;
};

/**
 * Rotating refresh tokens: only the newest one is accepted. Presenting an
 * older one means it leaked, so every session for this account is dropped.
 * The caller resolves the token from the cookie or the request body.
 */
export const refresh = async (refreshToken: string | null): Promise<AuthTokens> => {
    if (!refreshToken || !refreshToken.trim()) {
        throw ApiError.unauthorized("A refresh token is required.");
    }

    const payload = verifyRefreshToken(refreshToken);
    const user = await User.findById(payload.sub).select("+refresh_token_hash");
    if (!user) throw ApiError.unauthorized();

    if (!user.refresh_token_hash || user.refresh_token_hash !== hashRefreshToken(refreshToken)) {
        user.refresh_token_hash = null;
        await user.save();
        throw ApiError.unauthorized("Your session has been revoked. Please log in again.");
    }

    if (!user.is_active) {
        throw ApiError.forbidden("This account has been deactivated.");
    }

    const tokens = issueTokens({ _id: String(user._id), role: user.role, email: user.email });
    user.refresh_token_hash = hashRefreshToken(tokens.refreshToken);
    await user.save();

    return tokens;
};

/**
 * Identified by the refresh token rather than a verified request, so signing
 * out still works once the access token has expired - otherwise the cookie
 * would survive the logout and the user would look signed in. Every failure is
 * swallowed: the caller clears the cookies regardless.
 */
export const logout = async (refreshToken: string | null): Promise<void> => {
    if (!refreshToken) return;

    try {
        const payload = verifyRefreshToken(refreshToken);
        const user = await User.findById(payload.sub).select("+refresh_token_hash");
        if (!user) return;
        user.refresh_token_hash = null;
        await user.save();
    } catch {
        // An expired or tampered token cannot name an account, so there is
        // nothing to revoke. The local session still gets cleared.
    }
};

/**
 * Deliberately vague and always successful. A reset flow that reports
 * "account not found" lets anyone enumerate registered users.
 */
export const requestPasswordReset = async (identifier: unknown): Promise<{ message: string }> => {
    const query = identifierQuery(identifier);

    const user = await User.findOne(query)
        .select("email")
        .lean();

    if (user) {
        // TODO: send a real reset link or OTP here. Never log the token itself.
        console.log(`[auth] password reset requested for ${user.email}`);
    }

    return { message: "If that account exists, a reset link has been sent." };
};
