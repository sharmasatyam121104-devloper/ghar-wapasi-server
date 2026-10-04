import { Router } from "express";
import * as controller from "./verification.controller";
import { requireAdmin, requireAuth } from "../../middleware/auth.middleware";

const VerificationRouter = Router();

/*
 * Admin only. Every handler here also re-checks `assigned_admin_id` against
 * the caller, so an admin cannot reach another admin's queue by guessing an id.
 */
VerificationRouter.use(requireAuth, requireAdmin);

VerificationRouter.get("/requests", controller.listRequests);
VerificationRouter.get("/requests/:id", controller.getRequest);
VerificationRouter.post("/requests/:id/call", controller.scheduleCall);
VerificationRouter.delete("/requests/:id/call", controller.clearCall);
VerificationRouter.post("/requests/:id/approve", controller.approve);
VerificationRouter.post("/requests/:id/reject", controller.reject);

export default VerificationRouter;
