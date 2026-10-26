import type { UserDocument } from "../users/users.model";
import { AuditLog, type AuditLogDocument } from "./audit.model";

export interface AuditInput {
    action: string;
    targetType: string;
    targetId: string;
    detail: string;
}

/** Append-only record of admin/assignment actions. Never throws into the caller's request. */
export const recordAudit = async (actor: UserDocument, input: AuditInput): Promise<void> => {
    try {
        await AuditLog.create({
            actor_id: actor._id,
            actor_name: `${actor.first_name} ${actor.last_name}`.trim(),
            actor_role: actor.role,
            action: input.action,
            target_type: input.targetType,
            target_id: input.targetId,
            detail: input.detail,
        });
    } catch (error) {
        // The action itself already succeeded; an audit write must not turn it
        // into a 500. The process log keeps the failure visible to operators.
        console.error("[audit] could not record entry:", error instanceof Error ? error.message : error);
    }
};

export const listAuditLog = async (limit = 100): Promise<AuditLogDocument[]> =>
    AuditLog.find().sort({ created_at: -1 }).limit(Math.min(200, Math.max(1, limit)));
