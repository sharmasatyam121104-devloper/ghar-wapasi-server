import type { NextFunction, Request, Response } from "express";
import { isDatabaseReady } from "../config/db.config";

/**
 * Guards every data route with one cheap check.
 *
 * Without it a request made while Mongo is down sits in Mongoose's command
 * buffer for ten seconds and then fails with a driver timeout, which reads as
 * a server bug. A 503 says exactly what is wrong.
 */
export const requireDatabase = (_req: Request, res: Response, next: NextFunction): void => {
    if (isDatabaseReady()) {
        next();
        return;
    }

    res.status(503).json({
        success: false,
        message: "The database is not reachable right now. Please try again shortly.",
    });
};