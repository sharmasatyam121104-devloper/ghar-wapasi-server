/**
 * The four roles the frontend actually has. `Finder` and `Family` from the
 * original scaffold were dropped: neither has a portal, a route, or a set of
 * screens in ghar-wapasi-ui. The frontend's lowercase values are the contract.
 */
export type UserRole = "public" | "police" | "ngo" | "admin";

export const USER_ROLES: readonly UserRole[] = ["public", "police", "ngo", "admin"] as const;

/** Roles whose accounts need an admin review before their portal opens. */
export const VERIFIABLE_ROLES: readonly UserRole[] = ["police", "ngo"] as const;

export const isPoliceOrNgo = (role: UserRole): boolean => role === "police" || role === "ngo";

/**
 * Narrows an untrusted value (query string, request body) to a real role.
 * Returns undefined instead of throwing so callers can build a field error.
 */
export const parseUserRole = (value: unknown): UserRole | undefined => {
    if (typeof value !== "string") return undefined;
    const role = value.trim().toLowerCase() as UserRole;
    return USER_ROLES.includes(role) ? role : undefined;
};
