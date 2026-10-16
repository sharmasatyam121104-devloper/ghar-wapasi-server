import rateLimit from "express-rate-limit";

/**
 * Two-level rate limiting for the API.
 *
 * Every `/api` request passes the `globalLimiter` first and then, if its route
 * has one, a tighter limiter. So a normal caller gets 100 requests per 15
 * minutes app-wide, while uploads and sign-ins/logins are additionally capped
 * per hour - a request only reaches a route handler once both allow it.
 *
 * Keyed on `req.ip`. With `trust proxy` set in production (`app.ts`) this is the
 * `X-Forwarded-For` client behind the reverse proxy; without it, the socket
 * address.
 */

/** Outer layer: every `/api` route, 100 requests per 15 minutes per IP. */
export const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests, please try later" },
});

/**
 * Uploads: 20 files per hour per IP. The upload endpoint is open (registration
 * is open), so this is the main brake on the disk-fill abuse.
 */
export const criticalFileLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Upload limit exceeded, try after an hour" },
});

/**
 * Credential endpoints: 5 attempts per hour per IP, shared by `POST /login` and
 * `POST /register/police` - one bucket, so an attacker cannot spend 5 on each.
 */
export const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many attempts, try after an hour" },
});
