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

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
    const data = await usersService.updateMe(currentUser(req), requestBody(req));
    sendSuccess(res, data, { message: "Profile updated successfully." });
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
