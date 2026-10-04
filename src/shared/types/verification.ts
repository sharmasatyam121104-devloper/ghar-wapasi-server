export type VerificationStatus = "pending" | "verified" | "rejected";

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
    "pending",
    "verified",
    "rejected",
] as const;

/**
 * Six hours from submission, during which a police or NGO applicant may still
 * edit their own profile. Mirrors the frontend's `UPDATE_WINDOW_MS` countdown,
 * but enforced here because the client clock is not a security boundary.
 */
export const EDIT_WINDOW_MS = 6 * 60 * 60 * 1000;

export const parseVerificationStatus = (value: unknown): VerificationStatus | undefined => {
    if (typeof value !== "string") return undefined;
    const status = value.trim().toLowerCase() as VerificationStatus;
    return VERIFICATION_STATUSES.includes(status) ? status : undefined;
};
