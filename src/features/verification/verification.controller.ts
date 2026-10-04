import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { callerAdminId, requestBody, routeParam } from "../../shared/http/request";
import { sendSuccess } from "../../shared/http/response";
import { parseListQuery } from "../../shared/http/pagination";
import * as verificationService from "./verification.service";
import type { ScheduleCallInput } from "./verification.service";

export const listRequests = asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(
        res,
        await verificationService.listVerificationRequests(callerAdminId(req), parseListQuery(req)),
    );
});

export const getRequest = asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(
        res,
        await verificationService.getVerificationRequest(callerAdminId(req), routeParam(req, "id")),
    );
});

export const scheduleCall = asyncHandler(async (req: Request, res: Response) => {
    const payload = requestBody(req);
    sendSuccess(
        res,
        await verificationService.scheduleCall(callerAdminId(req), routeParam(req, "id"), {
            link: payload.link as string,
            time: payload.time as string,
            note: payload.note as string,
        } as ScheduleCallInput),
        { message: "Video call scheduled. The user can now see the link and time you set." },
    );
});

export const clearCall = asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(
        res,
        await verificationService.clearCall(callerAdminId(req), routeParam(req, "id")),
        { message: "Scheduled call cleared." },
    );
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(
        res,
        await verificationService.approveUser(callerAdminId(req), routeParam(req, "id")),
        { message: "Account verified." },
    );
});

export const reject = asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(
        res,
        await verificationService.rejectUser(
            callerAdminId(req),
            routeParam(req, "id"),
            requestBody(req).reason,
        ),
        { message: "Registration rejected." },
    );
});
