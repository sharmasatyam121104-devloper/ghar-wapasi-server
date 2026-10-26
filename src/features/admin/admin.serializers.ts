import type { SuspensionDocument } from "./suspension.model";

export const toSuspension = (suspension: SuspensionDocument) => ({
    id: String(suspension._id),
    target_user_id: String(suspension.target_user_id),
    target_name: suspension.target_name,
    target_role: suspension.target_role,
    category: suspension.category,
    reason: suspension.reason,
    proof: suspension.proof ?? [],
    report_ids: (suspension.report_ids ?? []).map(String),
    suspended_at: suspension.suspended_at,
    duration_days: suspension.duration_days,
    ends_at: suspension.ends_at,
    status: suspension.status,
    lifted_at: suspension.lifted_at,
    lift_note: suspension.lift_note,
    issued_by: String(suspension.issued_by),
    issued_by_name: suspension.issued_by_name,
    created_at: suspension.created_at,
    updated_at: suspension.updated_at,
});
