import type { ErrorDetail } from "../errors/ApiError";

/**
 * Reads a trimmed, required string field. Records a field-level error instead
 * of throwing so a whole form can be validated in one pass.
 */
export const requiredField = (value: unknown, field: string, errors: ErrorDetail): string => {
    if (typeof value !== "string" || !value.trim()) {
        errors[field] = "This field is required.";
        return "";
    }
    return value.trim();
};

/** Makes a user-supplied search term safe to drop into a RegExp. */
export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
