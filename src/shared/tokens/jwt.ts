import jwt, { type SignOptions, type VerifyOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import { ApiError } from "../errors/ApiError";
import { normalizeEmail } from "../validators/validators";
import type { UserRole } from "../types/roles";

const ISSUER = "ghar-wapasi-server";
const ACCESS_TOKEN_TTL: SignOptions["expiresIn"] = "2h";
const REFRESH_TOKEN_TTL: SignOptions["expiresIn"] = "7d";

/** The same durations in milliseconds - the cookies' maxAge. */
export const ACCESS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AccessTokenPayload {
    sub: string;
    role: UserRole;
    email: string;
    type: "access";
}

export interface RefreshTokenPayload {
    sub: string;
    type: "refresh";
    jti: string;
}

const readSecret = (name: string, fallback: string): string => {
    const value = process.env[name];
    if (value && value.trim()) return value;
    console.warn(`[auth] ${name} is not set - using an insecure development fallback.`);
    return fallback;
};

const accessSecret = (): string =>
    readSecret("JWT_ACCESS_SECRET", "dev-access-secret-change-me");
const refreshSecret = (): string =>
    readSecret("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me");

const baseOptions: SignOptions = { issuer: ISSUER };
const verifyOptions: VerifyOptions = { issuer: ISSUER };

export const signAccessToken = (payload: Omit<AccessTokenPayload, "type">): string =>
    jwt.sign({ ...payload, type: "access" }, accessSecret(), {
        ...baseOptions,
        expiresIn: ACCESS_TOKEN_TTL,
    });

export const signRefreshToken = (userId: string): string => {
    const payload: RefreshTokenPayload = {
        sub: userId,
        type: "refresh",
        jti: crypto.randomUUID(),
    };
    return jwt.sign(payload, refreshSecret(), {
        ...baseOptions,
        expiresIn: REFRESH_TOKEN_TTL,
    });
};

const verify = <T extends object>(token: string, secret: string, expected: string): T => {
    let decoded: unknown;
    try {
        decoded = jwt.verify(token, secret, verifyOptions);
    } catch {
        // Never leak the library's reason - it hints at forgery attempts.
        throw ApiError.unauthorized("Your session is invalid or has expired.");
    }

    if (typeof decoded !== "object" || decoded === null) {
        throw ApiError.unauthorized("Your session is invalid or has expired.");
    }

    if ((decoded as { type?: string }).type !== expected) {
        throw ApiError.unauthorized("Your session is invalid or has expired.");
    }

    return decoded as T;
};

export const verifyAccessToken = (token: string): AccessTokenPayload =>
    verify<AccessTokenPayload>(token, accessSecret(), "access");

export const verifyRefreshToken = (token: string): RefreshTokenPayload =>
    verify<RefreshTokenPayload>(token, refreshSecret(), "refresh");

/** Hash a refresh token so a database leak does not hand out usable sessions. */
export const hashRefreshToken = (token: string): string =>
    crypto.createHash("sha256").update(token).digest("hex");

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
}

export const issueTokens = (user: {
    _id: string;
    role: UserRole;
    email: string;
}): AuthTokens => ({
    accessToken: signAccessToken({ sub: user._id, role: user.role, email: normalizeEmail(user.email) }),
    refreshToken: signRefreshToken(user._id),
});
