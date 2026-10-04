import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../shared/errors/ApiError";
import { asyncHandler } from "../shared/http/asyncHandler";
import { readAccessToken } from "../shared/http/cookies";
import { verifyAccessToken } from "../shared/tokens/jwt";
import type { UserRole } from "../shared/types/roles";
import { User, type UserDocument } from "../features/users/users.model";

/**
 * Requires a valid access token and loads the user. The token may arrive in
 * the `access_token` cookie (the web client) or as `Authorization: Bearer`
 * (native and scripted clients). The account must still exist and be active.
 *
 * Note this does NOT require police/NGO accounts to be verified: they need
 * `/me` to read their own status and fix a rejected submission. Use
 * `requireVerifiedStaff` to gate the actual portal.
 */
export const requireAuth = asyncHandler(
    async (req: Request, _res: Response, next: NextFunction) => {
        const token = readAccessToken(req);
        if (!token) throw ApiError.unauthorized();

        const payload = verifyAccessToken(token);
        const user = await User.findById(payload.sub);
        if (!user) throw ApiError.unauthorized("Your account could not be found.");

        if (!user.is_active) {
            throw ApiError.forbidden("This account has been deactivated.");
        }

        req.user = user;
        next();
    },
);

/** Attaches the user when a token is present, but never rejects. */
export const optionalAuth = asyncHandler(
    async (req: Request, _res: Response, next: NextFunction) => {
        const token = readAccessToken(req);
        if (token) {
            try {
                const payload = verifyAccessToken(token);
                const user = await User.findById(payload.sub);
                if (user?.is_active) req.user = user;
            } catch {
                // An invalid token on a public route is simply ignored.
            }
        }
        next();
    },
);

/** Restricts a route to the listed roles. Must run after requireAuth. */
export const requireRole =
    (...roles: UserRole[]) =>
    (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user) return next(ApiError.unauthorized());
        if (!roles.includes(req.user.role)) {
            return next(
                ApiError.forbidden(
                    `This action is only available to: ${roles.join(", ")}.`,
                ),
            );
        }
        next();
    };

export const requireAdmin = requireRole("admin");

/** Police and NGO accounts, verified or not. */
export const requireStaff = requireRole("police", "ngo");

/**
 * Gate for the real police/NGO portal. An account that is still pending or
 * was rejected keeps a valid token - it just cannot open the portal.
 */
export const requireVerifiedStaff = [
    requireStaff,
    (req: Request, _res: Response, next: NextFunction): void => {
        if (req.user?.verification_status === "verified") return next();
        next(
            ApiError.forbidden(
                req.user?.verification_status === "rejected"
                    ? "Your registration was rejected. Please update and resubmit."
                    : "Your account is still waiting for admin verification.",
            ),
        );
    },
] as const;

export type { UserDocument };
