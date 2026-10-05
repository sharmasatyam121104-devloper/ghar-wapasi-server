import { Router } from "express";
import * as controller from "./otp.controller";
import { requireAuth } from "../../middleware/auth.middleware";

const OtpRouter = Router();

/**
 * The centralized OTP surface. Every purpose the product grows later is served by
 * these same two routes, so no new public endpoint is needed to add a flow.
 *
 *   POST /request  purpose + channel + target -> a code goes out
 *   POST /verify   challenge_id + code       -> a single-use receipt
 *
 * Both are authenticated: a code is only ever issued for, and spent by, the
 * signed-in account.
 */
OtpRouter.use(requireAuth);

OtpRouter.post("/request", controller.request);
OtpRouter.post("/verify", controller.verify);

export default OtpRouter;