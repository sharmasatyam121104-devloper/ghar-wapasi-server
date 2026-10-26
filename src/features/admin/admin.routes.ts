import { Router } from "express";
import * as controller from "./admin.controller";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";

/**
 * Admin console. Every handler re-checks scope against `assigned_admin_id`;
 * a superadmin sees all and is the only role allowed to create admins.
 */
const AdminRouter = Router();

AdminRouter.use(requireAuth, requireRole("admin", "superadmin"));

AdminRouter.get("/overview", controller.overview);
AdminRouter.get("/reports", controller.reports);
AdminRouter.patch("/reports/:id", controller.updateReportHandler);
AdminRouter.get("/suspensions", controller.suspensions);
AdminRouter.post("/suspensions", controller.suspend);
AdminRouter.post("/suspensions/:id/lift", controller.lift);
AdminRouter.get("/audit", controller.audit);

export default AdminRouter;
