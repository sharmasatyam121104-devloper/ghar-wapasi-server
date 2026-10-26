import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import type { Types } from "mongoose";

export interface AuditLogInterface {
    _id: Types.ObjectId;
    actor_id: Types.ObjectId;
    actor_name: string;
    actor_role: string;
    action: string;
    target_type: string;
    target_id: string;
    detail: string;
    created_at: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLogInterface>;

const auditLogSchema = new Schema<AuditLogInterface>(
    {
        actor_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
        actor_name: { type: String, required: true, trim: true },
        actor_role: { type: String, required: true, trim: true },
        action: { type: String, required: true, trim: true, maxlength: 80 },
        target_type: { type: String, required: true, trim: true, maxlength: 40 },
        target_id: { type: String, required: true, trim: true, maxlength: 120 },
        detail: { type: String, required: true, trim: true, maxlength: 1000 },
        created_at: { type: Date, default: Date.now },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: false },
    },
);

auditLogSchema.index({ created_at: -1 });
auditLogSchema.index({ actor_id: 1, created_at: -1 });
auditLogSchema.index({ target_type: 1, target_id: 1, created_at: -1 });

export const AuditLog: Model<AuditLogInterface> = model<AuditLogInterface>("AuditLog", auditLogSchema);
