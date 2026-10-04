import type { Request } from "express";
import type { UserRole } from "../types/roles";
import { parseUserRole } from "../types/roles";
import type { VerificationStatus } from "../types/verification";
import { parseVerificationStatus } from "../types/verification";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface ListQuery {
    role?: UserRole;
    verificationStatus?: VerificationStatus;
    search?: string;
    page?: number;
    limit?: number;
}

export interface ListResult<T> {
    users: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

/** Reads the shared list query params off the request. */
export const parseListQuery = (req: Request): ListQuery => ({
    page: Number.parseInt(String(req.query.page ?? "1"), 10),
    limit: Number.parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10),
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    role: parseUserRole(req.query.role),
    verificationStatus: parseVerificationStatus(req.query.verificationStatus),
});

/** Clamps paging into a safe range. `page=abc` becomes 1 instead of NaN. */
export const resolvePaging = (query: ListQuery): { page: number; limit: number } => {
    const toInt = (value: number | undefined, fallback: number): number =>
        Number.isFinite(value) ? Math.trunc(value as number) : fallback;

    return {
        page: Math.max(1, toInt(query.page, 1)),
        limit: Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(query.limit, DEFAULT_PAGE_SIZE))),
    };
};
