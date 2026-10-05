import { Router } from "express";
import authRoutes from "../features/auth/auth.routes";
import otpRoutes from "../features/otp/otp.routes";
import registrationRoutes from "../features/registration/registration.routes";
import usersRoutes from "../features/users/users.routes";
import verificationRoutes from "../features/verification/verification.routes";

/**
 * Every feature router is mounted here and nowhere else, so the full API
 * surface is readable in one file. Mounted under `/api` by `app.ts`.
 *
 *   /api/auth          login, refresh, forgot-password, logout, password
 *   /api/register      public / police / ngo sign-up, superadmin-only admin
 *   /api/otp           centralized codes for contact changes
 *                      POST /request  purpose + channel + target -> code sent
 *                      POST /verify   challenge_id + code       -> one-use receipt
 *   /api/users         own profile + admin listing
 *                      PATCH /me          public citizen - no approval
 *                      PATCH /me/police   re-queued for an admin review
 *                      PATCH /me/ngo      re-queued for an admin review
 *   /api/verification  admin review queue
 */
const ApiRouter = Router();

ApiRouter.use("/auth", authRoutes);
ApiRouter.use("/otp", otpRoutes);
ApiRouter.use("/register", registrationRoutes);
ApiRouter.use("/users", usersRoutes);
ApiRouter.use("/verification", verificationRoutes);

export default ApiRouter;
