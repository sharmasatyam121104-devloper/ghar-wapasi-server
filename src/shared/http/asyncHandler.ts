import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async handler so a rejected promise reaches the Express error
 * middleware. Express 5 forwards these on its own, but being explicit keeps
 * the behaviour obvious and survives a framework downgrade.
 */
export const asyncHandler = (
    handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler => {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
};
