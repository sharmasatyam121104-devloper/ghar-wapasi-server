import { Router } from "express";
import * as controller from "./registration.controller";

/**
 * One endpoint per role instead of one endpoint with a `role` field. The role
 * is fixed by the path, so a police or NGO account cannot be created through
 * the public sign-up form, and each form only has to send the fields its own
 * role collects.
 *
 *   /api/register          a member of the public
 *   /api/register/police   an officer, queued for admin review
 *   /api/register/ngo      an organisation, queued for admin review
 */
const RegistrationRouter = Router();

RegistrationRouter.post("/", controller.registerPublic);
RegistrationRouter.post("/police", controller.registerPolice);
RegistrationRouter.post("/ngo", controller.registerNgo);

export default RegistrationRouter;
