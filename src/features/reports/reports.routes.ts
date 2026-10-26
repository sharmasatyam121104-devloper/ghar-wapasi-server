import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { currentUser, requestBody } from "../../shared/http/request";
import { sendCreated, sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { createReport, listMyReports } from "./reports.service";
import { toReport } from "./reports.serializers";

const ReportsRouter = Router();

ReportsRouter.use(requireAuth);

ReportsRouter.post(
    "/",
    asyncHandler(async (req, res) => {
        const report = await createReport(currentUser(req), requestBody(req));
        sendCreated(res, toReport(report), "Report submitted. An admin will review it.");
    }),
);

ReportsRouter.get(
    "/mine",
    asyncHandler(async (req, res) => {
        const reports = await listMyReports(currentUser(req));
        sendSuccess(res, { reports: reports.map(toReport) });
    }),
);

export default ReportsRouter;
