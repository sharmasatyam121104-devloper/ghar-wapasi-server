export type ErrorDetail = Record<string, string>;

/**
 * Operational error that is safe to show to the client.
 * Anything thrown that is not an ApiError is treated as a bug and hidden
 * behind a generic 500 by the global error handler.
 */
export class ApiError extends Error {
    public readonly statusCode: number;
    public readonly errors?: ErrorDetail;
    public readonly isOperational: boolean;

    constructor(statusCode: number, message: string, errors?: ErrorDetail) {
        super(message);
        this.name = "ApiError";
        this.statusCode = statusCode;
        this.errors = errors;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }

    static badRequest(message: string, errors?: ErrorDetail) {
        return new ApiError(400, message, errors);
    }

    static unauthorized(message = "Authentication required.") {
        return new ApiError(401, message);
    }

    static forbidden(message = "You are not allowed to perform this action.") {
        return new ApiError(403, message);
    }

    static notFound(message = "Resource not found.") {
        return new ApiError(404, message);
    }

    static conflict(message: string, errors?: ErrorDetail) {
        return new ApiError(409, message, errors);
    }

    static unprocessable(message: string, errors?: ErrorDetail) {
        return new ApiError(422, message, errors);
    }

    static payloadTooLarge(message = "The request body is too large.") {
        return new ApiError(413, message);
    }

    static tooManyRequests(message = "Too many requests. Please try again later.") {
        return new ApiError(429, message);
    }

    static internal(message = "Something went wrong.") {
        return new ApiError(500, message);
    }

    /**
     * A dependency we need is not there - the database is down, or a provider we
     * have not wired up yet. Distinct from 500: nothing is wrong with the request
     * and the same request may well succeed a minute later, so a client should
     * not treat it as a bad input.
     */
    static serviceUnavailable(message = "This service is temporarily unavailable.") {
        return new ApiError(503, message);
    }
}
