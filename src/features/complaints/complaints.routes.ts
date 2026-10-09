import { Router } from "express";
import * as controller from "./complaints.controller";
import { requireAuth, requireRole, requireVerified } from "../../middleware/auth.middleware";

/**
 * Complaints.
 *
 *   GET   /api/complaints          every case, as public summaries
 *   GET   /api/complaints/:id      full for the filer (and their admin), else summary
 *   PATCH /api/complaints/:id      filer only - status / timeline
 *
 *   POST  /api/complaints/public   a member's own complaint
 *   POST  /api/complaints/police   filed by a verified police account
 *   POST  /api/complaints/ngo      filed by a verified NGO account
 *
 * The create role is the URL rather than a body field, so a request can only
 * ever file for the account type the route let through. Police and NGO desks
 * additionally require a verified account.
 */
const ComplaintsRouter = Router();

ComplaintsRouter.use(requireAuth);

ComplaintsRouter.get("/", controller.list);
ComplaintsRouter.get("/:id", controller.getById);
ComplaintsRouter.patch("/:id", controller.update);

ComplaintsRouter.post("/public", requireRole("public"), controller.registerPublicComplaint);
ComplaintsRouter.post("/police", requireRole("police"), requireVerified, controller.registerPoliceComplaint);
ComplaintsRouter.post("/ngo", requireRole("ngo"), requireVerified, controller.registerNgoComplaint);

export default ComplaintsRouter;
