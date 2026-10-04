import type { Request } from "express";
import { ApiError } from "../errors/ApiError";
import type { UserDocument } from "../../features/users/users.model";

/** Request body as a plain record. `express.json` leaves it undefined for empty bodies. */
export const requestBody = (req: Request): Record<string, unknown> =>
    (req.body ?? {}) as Record<string, unknown>;

/** Express 5 types a route param as `string | string[]`; ours are always scalar. */
export const routeParam = (req: Request, name: string): string => {
    const value = req.params[name];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};

/** The authenticated user. Only valid behind `requireAuth`. */
export const currentUser = (req: Request): UserDocument => {
    if (!req.user) throw ApiError.unauthorized();
    return req.user;
};

/** The calling admin's id - the scope every verification query is filtered to. */
export const callerAdminId = (req: Request): string => String(currentUser(req)._id);
