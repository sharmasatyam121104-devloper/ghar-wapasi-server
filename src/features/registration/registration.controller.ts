import type { Request, Response } from "express";
import { ApiError } from "../../shared/errors/ApiError";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { setAuthCookies } from "../../shared/http/cookies";
import { requestBody } from "../../shared/http/request";
import { sendCreated } from "../../shared/http/response";
import { parseUserRole } from "../../shared/types/roles";
import type { RegisterInput } from "./registration.service";
import { register as registerAccount } from "./registration.service";

export const register = asyncHandler(async (req: Request, res: Response) => {
    const payload = requestBody(req);
    const role = parseUserRole(payload.role);

    if (!role) {
        throw ApiError.badRequest("Role must be one of: public, police, ngo.");
    }

    const result = await registerAccount({
        role,
        first_name: payload.first_name as string,
        last_name: payload.last_name as string,
        aadhaar: payload.aadhaar as string,
        mobile: payload.mobile as string,
        email: payload.email as string,
        password: payload.password as string,
        police: payload.police as never,
        ngo: payload.ngo as never,
    } as RegisterInput);

    setAuthCookies(res, result.tokens);
    sendCreated(res, result, "Account created successfully.");
});
