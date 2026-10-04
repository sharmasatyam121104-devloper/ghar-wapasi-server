import type { Response } from "express";

/**
 * The single response envelope for the whole API. `message` and `data` are
 * both optional so a pure-acknowledgement route does not carry a null payload.
 */
export const sendSuccess = (
    res: Response,
    data?: unknown,
    options: { status?: number; message?: string } = {},
): Response => {
    const payload: Record<string, unknown> = { success: true };
    if (options.message) payload.message = options.message;
    if (data !== undefined) payload.data = data;
    return res.status(options.status ?? 200).json(payload);
};

export const sendCreated = (res: Response, data?: unknown, message?: string): Response =>
    sendSuccess(res, data, { status: 201, message });
