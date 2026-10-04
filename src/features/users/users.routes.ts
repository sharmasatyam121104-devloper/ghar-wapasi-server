import { Router } from "express";
import * as controller from "./users.controller";
import { requireAdmin, requireAuth } from "../../middleware/auth.middleware";

const UsersRouter = Router();

/* Own profile ------------------------------------------------------- */
UsersRouter.get("/me", requireAuth, controller.me);
UsersRouter.patch("/me", requireAuth, controller.updateMe);

/* Listing. Declared after `/me` so the literal path always wins over `:id`. */
UsersRouter.get("/", requireAuth, requireAdmin, controller.listUsers);
UsersRouter.get("/:id", requireAuth, requireAdmin, controller.getUser);

export default UsersRouter;
