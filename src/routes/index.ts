import { Router } from "express";
import authRoutes from "../features/auth/auth.routes";
import registrationRoutes from "../features/registration/registration.routes";
import usersRoutes from "../features/users/users.routes";
import verificationRoutes from "../features/verification/verification.routes";

/**
 * Every feature router is mounted here and nowhere else, so the full API
 * surface is readable in one file. Mounted under `/api` by `app.ts`.
 *
 *   /api/auth          login, refresh, forgot-password, logout, password
 *   /api/register      public / police / ngo sign-up, superadmin-only admin
 *   /api/users         own profile + admin listing
 *   /api/verification  admin review queue
 */
const ApiRouter = Router();

ApiRouter.use("/auth", authRoutes);
ApiRouter.use("/register", registrationRoutes);
ApiRouter.use("/users", usersRoutes);
ApiRouter.use("/verification", verificationRoutes);

export default ApiRouter;
