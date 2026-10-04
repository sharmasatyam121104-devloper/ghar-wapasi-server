/**
 * The roles the frontend actually has. `Finder` and `Family` from the original
 * scaffold were dropped: neither has a portal, a route, or a set of screens in
 * ghar-wapasi-ui. The frontend's lowercase values are the contract.
 *
 * `superadmin` is the one role the frontend has no screen for. It exists only
 * to hand out `admin` accounts, so it is deliberately not part of any portal.
 */
export type UserRole = "public" | "police" | "ngo" | "admin" | "superadmin";

export const USER_ROLES: readonly UserRole[] = ["public", "police", "ngo", "admin", "superadmin"] as const;

/** Roles whose accounts need an admin review before their portal opens. */
export const VERIFIABLE_ROLES: readonly UserRole[] = ["police", "ngo"] as const;

export const isPoliceOrNgo = (role: UserRole): boolean => role === "police" || role === "ngo";

/**
 * Roles with a `POST /api/register/...` endpoint. `superadmin` is absent on
 * purpose: it is minted by the admin CLI, never over HTTP, so there is no
 * request anywhere - not even a superadmin's - that can create one.
 *
 * The first three are open to anyone. `admin` is not self-service: it is the
 * one entry here whose route is gated behind `requireSuperAdmin`.
 */
export const REGISTRABLE_ROLES = ["public", "police", "ngo", "admin"] as const;

export type RegistrableRole = (typeof REGISTRABLE_ROLES)[number];

/** Where each registrable role is created. Used to point a caller at the right endpoint. */
export const REGISTER_ENDPOINT_BY_ROLE: Record<RegistrableRole, string> = {
    public: "/api/register",
    police: "/api/register/police",
    ngo: "/api/register/ngo",
    admin: "/api/register/admin",
};

/** Narrows to a role that has a registration endpoint. */
export const isRegistrableRole = (value: unknown): value is RegistrableRole =>
    typeof value === "string" && (REGISTRABLE_ROLES as readonly string[]).includes(value.trim().toLowerCase());

/**
 * Narrows an untrusted value (query string, request body) to a real role.
 * Returns undefined instead of throwing so callers can build a field error.
 */
export const parseUserRole = (value: unknown): UserRole | undefined => {
    if (typeof value !== "string") return undefined;
    const role = value.trim().toLowerCase() as UserRole;
    return USER_ROLES.includes(role) ? role : undefined;
};
