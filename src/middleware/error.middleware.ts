import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { ApiError, type ErrorDetail } from "../shared/errors/ApiError";
import { env } from "../config/env.config";

const { MongoServerError } = mongoose.mongo;

interface DuplicateKeyEntry {
    keyValue?: Record<string, unknown>;
}

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
    next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist.`));
};

interface BodyParserError {
    type?: string;
    status?: number;
    expose?: boolean;
}

/**
 * `express.json()` rejects a malformed or oversized body before any handler
 * runs. That is the caller's mistake, not a bug in this service, so it has to
 * come back as 4xx - without this it falls through to the generic 500, which
 * in production reads as "our fault" and sends the caller debugging the wrong
 * side.
 */
const translateBodyError = (error: unknown): ApiError | null => {
    const err = error as BodyParserError | null;
    if (!err?.type) return null;

    if (err.type === "entity.parse.failed") {
        return ApiError.badRequest("The request body is not valid JSON.");
    }
    if (err.type === "entity.too.large") {
        return ApiError.payloadTooLarge();
    }

    // Anything else body-parser flagged as safe to show (`expose: true`) still
    // carries its own status, so honour that instead of reporting a 500.
    if (err.expose === true && typeof err.status === "number") {
        return new ApiError(err.status, "The request body could not be read.");
    }

    return null;
};

const translateMongoError = (error: unknown): ApiError | null => {
    if (error instanceof mongoose.Error.ValidationError) {
        const errors: ErrorDetail = {};
        for (const [field, detail] of Object.entries(error.errors)) {
            errors[field] = detail.message;
        }
        return ApiError.unprocessable("Some of the details you entered are not valid.", errors);
    }

    if (error instanceof mongoose.Error.CastError) {
        return ApiError.badRequest(`"${String(error.value)}" is not a valid ${error.path}.`);
    }

    if (error instanceof MongoServerError && error.code === 11000) {
        const duplicated = (error as unknown as { keyValue?: DuplicateKeyEntry }).keyValue ?? {};
        const [field] = Object.keys(duplicated);
        const labels: Record<string, string> = {
            email: "An account with this email already exists.",
            mobile: "An account with this mobile number already exists.",
            aadhaar: "An account with this Aadhaar number already exists.",
        };
        return ApiError.conflict(
            labels[field ?? ""] ?? "An account with these details already exists.",
        );
    }

    return null;
};

export const errorHandler = (
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void => {
const translated = translateBodyError(error) ?? translateMongoError(error);
const apiError = translated ?? (error instanceof ApiError ? error : null);

    if (apiError) {
        res.status(apiError.statusCode).json({
            success: false,
            message: apiError.message,
            ...(apiError.errors ? { errors: apiError.errors } : {}),
        });
        return;
    }

    if (!(error instanceof Error)) {
        res.status(500).json({ success: false, message: "Something went wrong." });
        return;
    }

    // Anything reaching here is a bug, so log it but tell the client nothing.
    console.error("[error]", error);

    res.status(500).json({
        success: false,
        message: "Something went wrong on our side. Please try again.",
        ...(env.isProduction ? {} : { detail: error.message }),
    });
};
