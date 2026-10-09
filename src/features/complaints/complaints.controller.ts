import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { currentUser, requestBody, routeParam } from "../../shared/http/request";
import { sendCreated, sendSuccess } from "../../shared/http/response";
import {
    canViewComplaintInFull,
    findComplaint,
    listComplaints,
    registerNgoComplaint as registerNgoComplaintService,
    registerPoliceComplaint as registerPoliceComplaintService,
    registerPublicComplaint as registerPublicComplaintService,
    updateComplaint as updateComplaintService,
} from "./complaints.service";
import { toComplaintSummary, toPublicComplaint } from "./complaints.serializers";

/**
 * One create handler per role, each delegating to the service function that
 * pins the same role. That keeps the role a literal on both sides, so a request
 * can only ever file a complaint for the account type its route let through.
 *
 * Reads are shared: every signed-in account lists the same public summaries,
 * and a case opens in full only for its filer (or the admin assigned to them).
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

export const list = asyncHandler(async (_req: Request, res: Response) => {
    const complaints = await listComplaints();
    sendSuccess(res, { complaints: complaints.map(toComplaintSummary) });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
    const viewer = currentUser(req);
    const complaint = await findComplaint(routeParam(req, "id"));
    const full = await canViewComplaintInFull(viewer, complaint);
    sendSuccess(res, full ? toPublicComplaint(complaint) : toComplaintSummary(complaint));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
    const complaint = await updateComplaintService(String(currentUser(req)._id), routeParam(req, "id"), requestBody(req));
    sendSuccess(res, toPublicComplaint(complaint), { message: "Complaint updated successfully." });
});
