import type { Request, Response } from "express";
import { env } from "../../config/env.config";
import {
    ACCESS_TOKEN_TTL_MS,
    REFRESH_TOKEN_TTL_MS,
    type AuthTokens,
} from "../tokens/jwt";

/** Names of the cookies that carry a session when no Bearer header is sent. */
export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

/**
 * The refresh cookie is pinned to the refresh endpoint, so the long-lived
 * token is never attached to ordinary API calls - a stray `GET /api/users`
 * cannot leak it into a log or a third-party proxy.
 */
const REFRESH_COOKIE_PATH = "/api/auth/refresh";

/**
 * Must stay identical between set and clear, otherwise the browser keeps the
 * original cookie - a deletion only matches on path + name + flags.
 */
const cookieFlags = () => ({
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax" as const,
});

export const setAuthCookies = (res: Response, tokens: AuthTokens): void => {
    const flags = cookieFlags();
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
        ...flags,
        path: "/",
        maxAge: ACCESS_TOKEN_TTL_MS,
    });
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
        ...flags,
        path: REFRESH_COOKIE_PATH,
        maxAge: REFRESH_TOKEN_TTL_MS,
    });
};

export const clearAuthCookies = (res: Response): void => {
    const flags = cookieFlags();
    res.clearCookie(ACCESS_TOKEN_COOKIE, { ...flags, path: "/" });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { ...flags, path: REFRESH_COOKIE_PATH });
};

const decode = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

/** Reads one cookie off the raw header - the app ships no cookie-parser. */
export const readCookie = (req: Request, name: string): string | null => {
    const header = req.headers.cookie;
    if (!header) return null;

    for (const part of header.split(";")) {
        const separator = part.indexOf("=");
        if (separator < 0) continue;
        if (part.slice(0, separator).trim() !== name) continue;
        const value = decode(part.slice(separator + 1).trim());
        return value || null;
    }

    return null;
};

/**
 * The browser session lives in cookies, so the cookie is read first. Native
 * and scripted clients have no cookie jar and fall through to the header.
 */
export const readAccessToken = (req: Request): string | null => {
    const cookie = readCookie(req, ACCESS_TOKEN_COOKIE);
    if (cookie) return cookie;

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    return header.slice(7).trim() || null;
};

/** Native clients post the refresh token in the body; the web client omits it. */
export const readRefreshToken = (req: Request, bodyValue: unknown): string | null => {
    if (typeof bodyValue === "string" && bodyValue.trim()) return bodyValue.trim();
    return readCookie(req, REFRESH_TOKEN_COOKIE);
};