import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { currentUser, requestBody } from "../../shared/http/request";
import { sendSuccess } from "../../shared/http/response";
import * as otpService from "./otp.service";

/* ------------------------------------------------------------------ */
/* Request and confirm                                                 */
/* ------------------------------------------------------------------ */

/**
 * Both handlers sit behind `requireAuth`: a code is only ever issued for, or
 * spent on, the signed-in account. There is no route that sends a code to an
 * arbitrary address someone else supplied, which is what keeps this from
 * becoming a mail-bomb or an SMS-pump.
 */

export const request = asyncHandler(async (req: Request, res: Response) => {
    const data = await otpService.requestOtp(currentUser(req), requestBody(req));
    sendSuccess(res, data, { message: "We have sent you a code." });
});

export const verify = asyncHandler(async (req: Request, res: Response) => {
    const data = await otpService.verifyOtp(currentUser(req), requestBody(req));
    sendSuccess(res, data, { message: "Code confirmed." });
});