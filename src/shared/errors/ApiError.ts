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

    static tooManyRequests(message = "Too many requests. Please try again later.") {
        return new ApiError(429, message);
    }

    static internal(message = "Something went wrong.") {
        return new ApiError(500, message);
    }
}
