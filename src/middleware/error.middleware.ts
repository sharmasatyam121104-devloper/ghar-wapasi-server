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
    const translated = translateMongoError(error);
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
