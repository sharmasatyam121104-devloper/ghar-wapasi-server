import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/http/asyncHandler";
import {
    clearAuthCookies,
    readRefreshToken,
    setAuthCookies,
} from "../../shared/http/cookies";
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

    setAuthCookies(res, result.tokens);
    sendSuccess(res, result, { message: `Logged in as ${result.user.role}.` });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
    const tokens = await authService.refresh(
        readRefreshToken(req, requestBody(req).refreshToken),
    );
    setAuthCookies(res, tokens);
    sendSuccess(res, { tokens });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(readRefreshToken(req, requestBody(req).refreshToken));
    clearAuthCookies(res);
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

    // The password change revokes every refresh token on this account,
    // including this session's, so the cookies would only be dead weight.
    clearAuthCookies(res);
    sendSuccess(res, undefined, {
        message: "Password changed. Please log in again on your other devices.",
    });
});
