import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { currentUser, requestBody } from "../../shared/http/request";
import { sendCreated } from "../../shared/http/response";
import {
    registerNgoComplaint as registerNgoComplaintService,
    registerPoliceComplaint as registerPoliceComplaintService,
    registerPublicComplaint as registerPublicComplaintService,
} from "./complaints.service";
import { toPublicComplaint } from "./complaints.serializers";

/**
 * One handler per role, each delegating to the service function that pins the
 * same role. That keeps the role a literal on both sides, so a request can only
 * ever file a complaint for the account type its route let through.
 */

export const registerPublicComplaint = asyncHandler(async (req: Request, res: Response) => {
    const complaint = await registerPublicComplaintService(String(currentUser(req)._id), requestBody(req));
    sendCreated(res, toPublicComplaint(complaint), "Complaint registered successfully.");
});

export const registerPoliceComplaint = asyncHandler(async (req: Request, res: Response) => {
    const complaint = await registerPoliceComplaintService(String(currentUser(req)._id), requestBody(req));
    sendCreated(res, toPublicComplaint(complaint), "Complaint registered successfully.");
});

export const registerNgoComplaint = asyncHandler(async (req: Request, res: Response) => {
    const complaint = await registerNgoComplaintService(String(currentUser(req)._id), requestBody(req));
    sendCreated(res, toPublicComplaint(complaint), "Complaint registered successfully.");
});
