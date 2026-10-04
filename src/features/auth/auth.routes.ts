import { Router } from "express";
import * as controller from "./auth.controller";
import { requireAuth } from "../../middleware/auth.middleware";

const AuthRouter = Router();

/* Public --------------------------------------------------------- */
AuthRouter.post("/login", controller.login);
AuthRouter.post("/refresh", controller.refresh);
AuthRouter.post("/forgot-password", controller.forgotPassword);
// No `requireAuth`: an expired access token must not trap the user in a
// session they cannot sign out of. The handler clears the cookies either way.
AuthRouter.post("/logout", controller.logout);

/* Authenticated -------------------------------------------------- */
AuthRouter.post("/password", requireAuth, controller.changePasswordHandler);

export default AuthRouter;
