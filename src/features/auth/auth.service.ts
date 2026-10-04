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
    normalizeEmail,
    stripNonDigits,
} from "../../shared/validators/validators";
import { User, type UserDocument } from "../users/users.model";
import { toPublicUser } from "../users/users.serializers";
import type { PublicUser, UserInterface } from "../users/users.types";

export interface LoginResult {
    user: PublicUser;
    tokens: AuthTokens;
    pendingVerification: boolean;
    rejectionReason?: string;
    updateWindowEndsAt?: Date;
}

/**
 * Accepts an email or a 12-digit Aadhaar number, exactly like the frontend's
 * single login field. The role is always read from the stored record, never
 * from the request body.
 */
export const login = async (identifier: string, password: string): Promise<LoginResult> => {
    if (typeof identifier !== "string" || !identifier.trim()) {
        throw ApiError.badRequest("Enter your email or 12-digit Aadhaar number.");
    }
    if (typeof password !== "string" || !password) {
        throw ApiError.badRequest("Password is required.");
    }

    const value = identifier.trim();
    const query: QueryFilter<UserInterface> = isAadhaar(value)
        ? { aadhaar: stripNonDigits(value) }
        : { email: normalizeEmail(value) };

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
 */
export const refresh = async (refreshToken: string): Promise<AuthTokens> => {
    if (typeof refreshToken !== "string" || !refreshToken) {
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

export const logout = async (user: UserDocument): Promise<void> => {
    user.refresh_token_hash = null;
    await user.save();
};

/**
 * Deliberately vague and always successful. A reset flow that reports
 * "account not found" lets anyone enumerate registered users.
 */
export const requestPasswordReset = async (identifier: unknown): Promise<{ message: string }> => {
    if (typeof identifier !== "string" || !identifier.trim()) {
        throw ApiError.badRequest("Enter your email or 12-digit Aadhaar number.");
    }

    const value = identifier.trim();
    const user = await User.findOne(
        isAadhaar(value) ? { aadhaar: stripNonDigits(value) } : { email: normalizeEmail(value) },
    )
        .select("email")
        .lean();

    if (user) {
        // TODO: send a real reset link or OTP here. Never log the token itself.
        console.log(`[auth] password reset requested for ${user.email}`);
    }

    return { message: "If that account exists, a reset link has been sent." };
};
