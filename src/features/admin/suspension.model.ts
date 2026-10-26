import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import type { Types } from "mongoose";

export type SuspensionStatus = "active" | "lifted";

export interface SuspensionInterface {
    _id: Types.ObjectId;
    target_user_id: Types.ObjectId;
    target_name: string;
    target_role: string;
    category: string;
    reason: string;
    proof: string[];
    report_ids: Types.ObjectId[];
    suspended_at: Date;
    duration_days: number;
    ends_at?: Date;
    status: SuspensionStatus;
    lifted_at?: Date;
    lift_note: string;
    issued_by: Types.ObjectId;
    issued_by_name: string;
    created_at: Date;
    updated_at: Date;
}

export type SuspensionDocument = HydratedDocument<SuspensionInterface>;

const suspensionSchema = new Schema<SuspensionInterface>(
    {
        target_user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
        target_name: { type: String, required: true, trim: true },
        target_role: { type: String, required: true, trim: true },
        category: { type: String, required: true, trim: true, maxlength: 120 },
        reason: { type: String, required: true, trim: true, maxlength: 2000 },
        proof: { type: [String], default: [] },
        report_ids: { type: [Schema.Types.ObjectId], ref: "Report", default: [] },
        suspended_at: { type: Date, default: Date.now },
        duration_days: { type: Number, default: 0, min: 0 },
        ends_at: { type: Date },
        status: { type: String, enum: ["active", "lifted"], default: "active" },
        lifted_at: { type: Date },
        lift_note: { type: String, trim: true, maxlength: 1000, default: "" },
        issued_by: { type: Schema.Types.ObjectId, ref: "User", required: true },
        issued_by_name: { type: String, required: true, trim: true },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    },
);

suspensionSchema.index({ target_user_id: 1, status: 1 });
suspensionSchema.index({ status: 1, ends_at: 1 });
suspensionSchema.index({ created_at: -1 });

export const Suspension: Model<SuspensionInterface> = model<SuspensionInterface>("Suspension", suspensionSchema);
