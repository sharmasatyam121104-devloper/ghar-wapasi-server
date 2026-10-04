import type { Request, Response } from "express";
import { ApiError } from "../../shared/errors/ApiError";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { setAuthCookies } from "../../shared/http/cookies";
import { requestBody } from "../../shared/http/request";
import { sendCreated } from "../../shared/http/response";
import {
    isRegistrableRole,
    parseUserRole,
    REGISTER_ENDPOINT_BY_ROLE,
    type RegistrableRole,
} from "../../shared/types/roles";
import { registerAdmin as provisionAdmin } from "./admin-registration.service";
import { registerNgo as createNgo } from "./ngo-registration.service";
import { registerPolice as createPolice } from "./police-registration.service";
import { registerPublic as createPublic } from "./public-registration.service";

/**
 * Each role signs up at its own endpoint, so the role is decided by the path
 * rather than by a field in the body. A caller can no longer create a police
 * account through the public form by sending `role: "police"`, and each form
 * only has to describe the fields its own role actually collects.
 *
 * Every handler below calls its own role's service. There is no shared
 * `register(role, body)` left to pass the wrong literal into.
 */

/** "an admin" but "a public" - the messages below are shown to the person signing up. */
const article = (role: RegistrableRole): string => (role === "admin" ? "an" : "a");

/**
 * Older clients sent `role` in the body. Honour it when it agrees with the
 * path, and otherwise say which endpoint to use instead of silently creating
 * the wrong kind of account.
 */
const assertRoleMatchesEndpoint = (claimed: unknown, role: RegistrableRole): void => {
    if (claimed === undefined || claimed === null || claimed === "") return;

    const parsed = parseUserRole(claimed);
    if (parsed === role) return;

    const other = parsed && isRegistrableRole(parsed) ? REGISTER_ENDPOINT_BY_ROLE[parsed] : undefined;
    throw ApiError.badRequest(
        other
            ? `This endpoint only creates ${article(role)} ${role} account. To sign up as ${parsed}, use POST ${other}.`
            : `This endpoint only creates ${article(role)} ${role} account. Remove the "role" field - the endpoint already decides it.`,
    );
};

export const registerPublic = asyncHandler(async (req: Request, res: Response) => {
    const body = requestBody(req);
    assertRoleMatchesEndpoint(body.role, "public");

    const result = await createPublic(body);

    setAuthCookies(res, result.tokens);
    sendCreated(res, result, "Account created successfully.");
});

export const registerPolice = asyncHandler(async (req: Request, res: Response) => {
    const body = requestBody(req);
    assertRoleMatchesEndpoint(body.role, "police");

    const result = await createPolice(body);

    setAuthCookies(res, result.tokens);
    sendCreated(res, result, "Account created successfully.");
});

export const registerNgo = asyncHandler(async (req: Request, res: Response) => {
    const body = requestBody(req);
    assertRoleMatchesEndpoint(body.role, "ngo");

    const result = await createNgo(body);

    setAuthCookies(res, result.tokens);
    sendCreated(res, result, "Account created successfully.");
});

/**
 * Admin provisioning, and the odd one out: no `setAuthCookies` call.
 *
 * The caller here is a superadmin, not the new account. Setting the cookies
 * would hand them the new admin's session and eject them from their own, so
 * this response carries the created user only and the new admin signs in for
 * themselves. See `admin-registration.service.ts` for the same reasoning.
 */
export const registerAdmin = asyncHandler(async (req: Request, res: Response) => {
    const body = requestBody(req);
    assertRoleMatchesEndpoint(body.role, "admin");

    const result = await provisionAdmin(body);

    sendCreated(res, result, "Admin account created successfully.");
});
