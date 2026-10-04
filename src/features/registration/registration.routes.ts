import { Router } from "express";
import * as controller from "./registration.controller";

const RegistrationRouter = Router();

RegistrationRouter.post("/", controller.register);

export default RegistrationRouter;
