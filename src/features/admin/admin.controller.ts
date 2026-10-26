import type { Request, Response } from "express";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { currentUser, requestBody, routeParam } from "../../shared/http/request";
import { sendCreated, sendSuccess } from "../../shared/http/response";
import { toReport } from "../reports/reports.serializers";
import { listReports, updateReport } from "../reports/reports.service";
import { getOverview, listAudit } from "./admin.service";
import { toSuspension } from "./admin.serializers";
import { createSuspension, liftSuspension, listSuspensions } from "./suspension.service";

export const overview = asyncHandler(async (req: Request, res: Response) => {
    const data = await getOverview(currentUser(req));
    sendSuccess(res, {
        ...data,
        recent_reports: data.recent_reports.map(toReport),
        recent_suspensions: data.recent_suspensions.map(toSuspension),
    });
});

export const reports = asyncHandler(async (req: Request, res: Response) => {
    const result = await listReports(currentUser(req), {
        page: Number.parseInt(String(req.query.page ?? "1"), 10),
        limit: Number.parseInt(String(req.query.limit ?? "20"), 10),
        status: typeof req.query.status === "string" ? req.query.status : undefined,
    });
    sendSuccess(res, {
        reports: result.reports.map(toReport),
        total: result.total,
        page: result.page,
        limit: result.limit,
        total_pages: result.totalPages,
    });
});

export const updateReportHandler = asyncHandler(async (req: Request, res: Response) => {
    const report = await updateReport(currentUser(req), routeParam(req, "id"), requestBody(req));
    sendSuccess(res, toReport(report), { message: "Report updated." });
});

export const suspensions = asyncHandler(async (req: Request, res: Response) => {
    const result = await listSuspensions(currentUser(req), {
        page: Number.parseInt(String(req.query.page ?? "1"), 10),
        limit: Number.parseInt(String(req.query.limit ?? "20"), 10),
        status: typeof req.query.status === "string" ? req.query.status : undefined,
    });
    sendSuccess(res, {
        suspensions: result.suspensions.map(toSuspension),
        total: result.total,
        page: result.page,
        limit: result.limit,
        total_pages: result.totalPages,
    });
});

export const suspend = asyncHandler(async (req: Request, res: Response) => {
    const suspension = await createSuspension(currentUser(req), requestBody(req));
    sendCreated(res, toSuspension(suspension), "Account suspended.");
});

export const lift = asyncHandler(async (req: Request, res: Response) => {
    const suspension = await liftSuspension(currentUser(req), routeParam(req, "id"), requestBody(req));
    sendSuccess(res, toSuspension(suspension), { message: "Suspension lifted." });
});

export const audit = asyncHandler(async (req: Request, res: Response) => {
    const logs = await listAudit(currentUser(req), Number(req.query.limit ?? 100));
    sendSuccess(res, {
        logs: logs.map((log) => ({
            id: String(log._id),
            actor_id: String(log.actor_id),
            actor_name: log.actor_name,
            actor_role: log.actor_role,
            action: log.action,
            target_type: log.target_type,
            target_id: log.target_id,
            detail: log.detail,
            created_at: log.created_at,
        })),
    });
});
