import type { Request, Response } from "express";
import { ApiError } from "../../shared/errors/ApiError";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { setAuthCookies } from "../../shared/http/cookies";
import { requestBody } from "../../shared/http/request";
import { sendCreated } from "../../shared/http/response";
import { parseUserRole, isSelfRegisterRole, type SelfRegisterRole } from "../../shared/types/roles";
import { register as registerAccount } from "./registration.service";

/**
 * Each role signs up at its own endpoint, so the role is decided by the path
 * rather than by a field in the body. A caller can no longer create a police
 * account through the public form by sending `role: "police"`, and each form
 * only has to describe the fields its own role actually collects.
 */
const ENDPOINT_BY_ROLE: Record<SelfRegisterRole, string> = {
    public: "/api/register",
    police: "/api/register/police",
    ngo: "/api/register/ngo",
};

/**
 * Older clients sent `role` in the body. Honour it when it agrees with the
 * path, and otherwise say which endpoint to use instead of silently creating
 * the wrong kind of account.
 */
const assertRoleMatchesEndpoint = (claimed: unknown, role: SelfRegisterRole): void => {
    if (claimed === undefined || claimed === null || claimed === "") return;
    if (parseUserRole(claimed) === role) return;

    const other = isSelfRegisterRole(claimed) ? ENDPOINT_BY_ROLE[claimed] : undefined;
    throw ApiError.badRequest(
        other
            ? `This endpoint only creates a ${role} account. To sign up as ${claimed}, use POST ${other}.`
            : `This endpoint only creates a ${role} account. Remove the "role" field - the endpoint already decides it.`,
    );
};

const registerAs = (role: SelfRegisterRole) =>
    asyncHandler(async (req: Request, res: Response) => {
        const body = requestBody(req);
        assertRoleMatchesEndpoint(body.role, role);

        const result = await registerAccount(role, body);

        setAuthCookies(res, result.tokens);
        sendCreated(res, result, "Account created successfully.");
    });

export const registerPublic = registerAs("public");
export const registerPolice = registerAs("police");
export const registerNgo = registerAs("ngo");
