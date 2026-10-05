import { Router } from "express";
import * as controller from "./users.controller";
import { requireAdmin, requireAuth } from "../../middleware/auth.middleware";

const UsersRouter = Router();

/* Own profile ------------------------------------------------------- */
UsersRouter.get("/me", requireAuth, controller.me);

/**
 * Three separate update endpoints, one per role.
 *
 * A public citizen edits on `/me` and is never re-reviewed, because they were
 * never vetted. Police and NGO edits re-queue the account for an admin, so they
 * get their own endpoints rather than a `role` switch inside one handler.
 */
UsersRouter.patch("/me", requireAuth, controller.updatePublicProfile);
UsersRouter.patch("/me/police", requireAuth, controller.updatePoliceProfile);
UsersRouter.patch("/me/ngo", requireAuth, controller.updateNgoProfile);

/* Listing. Declared after `/me` so the literal path always wins over `:id`. */
UsersRouter.get("/", requireAuth, requireAdmin, controller.listUsers);
UsersRouter.get("/:id", requireAuth, requireAdmin, controller.getUser);

export default UsersRouter;
