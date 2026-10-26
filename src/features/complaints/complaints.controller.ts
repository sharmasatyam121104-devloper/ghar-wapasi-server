import type { Request, Response } from "express";
import { ApiError } from "../../shared/errors/ApiError";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { currentUser, requestBody, routeParam } from "../../shared/http/request";
import { sendCreated, sendSuccess } from "../../shared/http/response";
import {
    addComplaintNote,
    assignComplaint,
    canReadComplaint,
    canViewComplaintInFull,
    claimComplaint,
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

export const list = asyncHandler(async (req: Request, res: Response) => {
    const result = await listComplaints(currentUser(req), {
        page: Number.parseInt(String(req.query.page ?? "1"), 10),
        limit: Number.parseInt(String(req.query.limit ?? "20"), 10),
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        mine: req.query.mine === "true" || req.query.mine === "1",
    });
    sendSuccess(res, {
        complaints: result.complaints.map(toComplaintSummary),
        total: result.total,
        page: result.page,
        limit: result.limit,
        total_pages: result.totalPages,
    });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
    const viewer = currentUser(req);
    const complaint = await findComplaint(routeParam(req, "id"));
    if (!(await canReadComplaint(viewer, complaint))) {
        throw ApiError.notFound("We could not find that complaint.");
    }
    const full = await canViewComplaintInFull(viewer, complaint);
    sendSuccess(res, full ? toPublicComplaint(complaint) : toComplaintSummary(complaint));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
    const complaint = await updateComplaintService(currentUser(req), routeParam(req, "id"), requestBody(req));
    sendSuccess(res, toPublicComplaint(complaint), { message: "Complaint updated successfully." });
});

export const assign = asyncHandler(async (req: Request, res: Response) => {
    const complaint = await assignComplaint(currentUser(req), routeParam(req, "id"), requestBody(req));
    sendSuccess(res, toPublicComplaint(complaint), { message: "Case assigned successfully." });
});

export const claim = asyncHandler(async (req: Request, res: Response) => {
    const complaint = await claimComplaint(currentUser(req), routeParam(req, "id"));
    sendSuccess(res, toPublicComplaint(complaint), { message: "Case claimed successfully." });
});

export const addNote = asyncHandler(async (req: Request, res: Response) => {
    const complaint = await addComplaintNote(currentUser(req), routeParam(req, "id"), requestBody(req));
    sendSuccess(res, toPublicComplaint(complaint), { message: "Note added successfully." });
});
