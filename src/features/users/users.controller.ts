import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { currentUser, requestBody, routeParam } from "../../shared/http/request";
import { sendSuccess } from "../../shared/http/response";
import { parseListQuery } from "../../shared/http/pagination";
import * as usersService from "./users.service";
import { toPublicUser } from "./users.serializers";

/* ------------------------------------------------------------------ */
/* Own profile                                                         */
/* ------------------------------------------------------------------ */

export const me = asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, usersService.getMe(currentUser(req)));
});

/**
 * One handler per role, each pointing at its own service function, so the
 * response message can tell the caller whether an admin still has to look at
 * what they just sent.
 */
export const updatePublicProfile = asyncHandler(async (req: Request, res: Response) => {
    const data = await usersService.updatePublicProfile(currentUser(req), requestBody(req));
    sendSuccess(res, data, { message: "Profile updated successfully." });
});

export const updatePoliceProfile = asyncHandler(async (req: Request, res: Response) => {
    const data = await usersService.updatePoliceProfile(currentUser(req), requestBody(req));
    sendSuccess(res, data, {
        message: "Profile updated. An admin has to review it before your portal opens again.",
    });
});

export const updateNgoProfile = asyncHandler(async (req: Request, res: Response) => {
    const data = await usersService.updateNgoProfile(currentUser(req), requestBody(req));
    sendSuccess(res, data, {
        message: "Profile updated. An admin has to review it before your portal opens again.",
    });
});

/* ------------------------------------------------------------------ */
/* Listing (admin)                                                     */
/* ------------------------------------------------------------------ */

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await usersService.listUsers(parseListQuery(req)));
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
    const user = await usersService.getById(routeParam(req, "id"));
    sendSuccess(res, toPublicUser(user));
});
