import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { currentUser, requestBody } from "../../shared/http/request";
import { sendSuccess } from "../../shared/http/response";
import * as authService from "./auth.service";
import { changePassword } from "./password.service";

export const login = asyncHandler(async (req: Request, res: Response) => {
    const payload = requestBody(req);
    const result = await authService.login(
        payload.identifier as string,
        payload.password as string,
    );

    sendSuccess(res, result, { message: `Logged in as ${result.user.role}.` });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
    const tokens = await authService.refresh(requestBody(req).refreshToken as string);
    sendSuccess(res, { tokens });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(currentUser(req));
    sendSuccess(res, undefined, { message: "Signed out." });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
    const { message } = await authService.requestPasswordReset(requestBody(req).identifier);
    sendSuccess(res, undefined, { message });
});

export const changePasswordHandler = asyncHandler(async (req: Request, res: Response) => {
    const payload = requestBody(req);
    await changePassword(
        currentUser(req),
        payload.current_password,
        payload.new_password,
    );

    sendSuccess(res, undefined, {
        message: "Password changed. Please log in again on your other devices.",
    });
});