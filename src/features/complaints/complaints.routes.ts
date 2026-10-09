import { Router } from "express";
import * as controller from "./complaints.controller";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";

/**
 * One handler per role, and the role is the URL rather than a body field, so a
 * request can only ever file for the account type the route let through.
 *
 *   POST /api/complaints/public   a member's own complaint
 *   POST /api/complaints/police   filed by a police account
 *   POST /api/complaints/ngo      filed by an NGO account
 */
const ComplaintsRouter = Router();

ComplaintsRouter.use(requireAuth);

ComplaintsRouter.post("/public", requireRole("public"), controller.registerPublicComplaint);
ComplaintsRouter.post("/police", requireRole("police"), controller.registerPoliceComplaint);
ComplaintsRouter.post("/ngo", requireRole("ngo"), controller.registerNgoComplaint);

export default ComplaintsRouter;
