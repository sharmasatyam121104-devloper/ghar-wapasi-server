import { Router } from "express";
import * as controller from "./auth.controller";
import { requireAuth } from "../../middleware/auth.middleware";

const AuthRouter = Router();

/* Public --------------------------------------------------------- */
AuthRouter.post("/login", controller.login);
AuthRouter.post("/refresh", controller.refresh);
AuthRouter.post("/forgot-password", controller.forgotPassword);

/* Authenticated -------------------------------------------------- */
AuthRouter.post("/logout", requireAuth, controller.logout);
AuthRouter.post("/password", requireAuth, controller.changePasswordHandler);

export default AuthRouter;