import { Router } from "express";
import * as controller from "./registration.controller";
import { requireAuth, requireSuperAdmin } from "../../middleware/auth.middleware";

/**
 * One endpoint per role instead of one endpoint with a `role` field. The role
 * is fixed by the path, so a police or NGO account cannot be created through
 * the public sign-up form, and each form only has to send the fields its own
 * role collects.
 *
 *   /api/register          a member of the public          open
 *   /api/register/police   an officer, queued for review   open
 *   /api/register/ngo      an organisation, queued         open
 *   /api/register/admin    another admin                   superadmin only
 *
 * The first three are self-service: the caller is the person signing up, which
 * is why they hand back a session. The fourth is provisioning - the caller is a
 * superadmin acting for somebody else, so it is behind auth and returns no
 * tokens.
 *
 * There is no endpoint for `superadmin` at all. Those accounts come from the
 * admin CLI, so no HTTP request can create one, whatever role it holds.
 */
const RegistrationRouter = Router();

RegistrationRouter.post("/", controller.registerPublic);
RegistrationRouter.post("/police", controller.registerPolice);
RegistrationRouter.post("/ngo", controller.registerNgo);
RegistrationRouter.post("/admin", requireAuth, requireSuperAdmin, controller.registerAdmin);

export default RegistrationRouter;
