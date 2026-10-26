import { Router } from "express";
import * as controller from "./complaints.controller";
import { requireAuth, requireRole, requireVerified, requireVerifiedRole } from "../../middleware/auth.middleware";

/**
 * Complaints.
 *
 *   GET   /api/complaints          scoped summaries, paginated; `?mine=1` for own
 *   GET   /api/complaints/:id      full for the filer/assigned/officer/admin, else summary
 *   PATCH /api/complaints/:id      filer, assigned officer, responsible admin, superadmin
 *   PATCH /api/complaints/:id/assign  admin hands a case to a verified officer
 *   POST  /api/complaints/:id/claim   verified officer claims an unassigned case
 *   POST  /api/complaints/:id/notes   case note by anyone with full access
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
ComplaintsRouter.patch("/:id/assign", requireRole("admin", "superadmin"), controller.assign);
ComplaintsRouter.post("/:id/claim", ...requireVerifiedRole("police", "ngo"), controller.claim);
ComplaintsRouter.post("/:id/notes", controller.addNote);

ComplaintsRouter.post("/public", requireRole("public"), controller.registerPublicComplaint);
ComplaintsRouter.post("/police", requireRole("police"), requireVerified, controller.registerPoliceComplaint);
ComplaintsRouter.post("/ngo", requireRole("ngo"), requireVerified, controller.registerNgoComplaint);

export default ComplaintsRouter;
