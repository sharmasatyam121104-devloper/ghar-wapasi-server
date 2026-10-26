import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import type { Types } from "mongoose";

export type ReportStatus = "open" | "reviewing" | "closed";

export interface ReportInterface {
    _id: Types.ObjectId;
    target_user_id: Types.ObjectId;
    target_name: string;
    target_role: string;
    case_id?: Types.ObjectId;
    case_ref?: string;
    reported_by: Types.ObjectId;
    reporter_name: string;
    reporter_contact: string;
    category: string;
    details: string;
    proof: string[];
    status: ReportStatus;
    resolution: string;
    reviewed_by?: Types.ObjectId;
    reviewed_at?: Date;
    created_at: Date;
    updated_at: Date;
}

export type ReportDocument = HydratedDocument<ReportInterface>;

const reportSchema = new Schema<ReportInterface>(
    {
        target_user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
        target_name: { type: String, required: true, trim: true },
        target_role: { type: String, required: true, trim: true },
        case_id: { type: Schema.Types.ObjectId, ref: "Complaint" },
        case_ref: { type: String, trim: true },
        reported_by: { type: Schema.Types.ObjectId, ref: "User", required: true },
        reporter_name: { type: String, required: true, trim: true },
        reporter_contact: { type: String, required: true, trim: true },
        category: { type: String, required: true, trim: true, maxlength: 120 },
        details: { type: String, required: true, trim: true, maxlength: 2000 },
        proof: { type: [String], default: [] },
        status: { type: String, enum: ["open", "reviewing", "closed"], default: "open" },
        resolution: { type: String, trim: true, maxlength: 2000, default: "" },
        reviewed_by: { type: Schema.Types.ObjectId, ref: "User" },
        reviewed_at: { type: Date },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    },
);

reportSchema.index({ status: 1, created_at: -1 });
reportSchema.index({ target_user_id: 1, created_at: -1 });
reportSchema.index({ reported_by: 1, created_at: -1 });

export const Report: Model<ReportInterface> = model<ReportInterface>("Report", reportSchema);
