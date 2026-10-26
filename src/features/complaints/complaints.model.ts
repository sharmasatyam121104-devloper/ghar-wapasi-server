import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import type { ComplaintInterface } from "./complaints.types";

export type ComplaintDocument = HydratedDocument<ComplaintInterface>;

const caseEventSchema = new Schema(
  {
    title: { type: String, required: true },
    date: { type: Date, required: true },
    detail: { type: String, required: true },
    state: { type: String, enum: ["done", "current", "pending"], required: true },
  },
  { _id: false }
);

const caseNoteSchema = new Schema(
  {
    author_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    author_name: { type: String, required: true, trim: true },
    author_role: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const complaintSchema = new Schema<ComplaintInterface>(
  {
    person_name: { type: String, required: true, trim: true },
    person_age: { type: Number, required: true },
    person_gender: { type: String, required: true, trim: true },
    person_height: { type: String, trim: true },
    person_build: { type: String, trim: true },
    person_marks: { type: String, trim: true },
    person_clothing: { type: String, trim: true },
    person_medical_notes: { type: String, trim: true },
    person_languages: { type: String, trim: true },

    last_seen_date: { type: Date, required: true },
    last_seen_time: { type: String, trim: true },
    last_seen_place: { type: String, required: true, trim: true },
    last_seen_city: { type: String, required: true, trim: true },
    last_seen_area: { type: String, trim: true },
    circumstances: { type: String, trim: true },

    complainant_name: { type: String, required: true, trim: true },
    complainant_relation: { type: String, required: true, trim: true },
    complainant_aadhaar: { type: String, required: true, trim: true },
    complainant_mobile: { type: String, required: true, trim: true },
    complainant_address: { type: String, required: true, trim: true },

    member_name: { type: String, required: true, trim: true },
    member_relation: { type: String, required: true, trim: true },
    member_aadhaar: { type: String, required: true, trim: true },
    member_mobile: { type: String, required: true, trim: true },

    police_station: { type: String, required: true, trim: true },
    fir_number: { type: String, required: true, trim: true },
    fir_date: { type: Date, required: true },

    person_photos: { type: [String], default: [] },
    location_photos: { type: [String], default: [] },
    complainant_id_files: { type: [String], default: [] },
    member_id_files: { type: [String], default: [] },
    fir_copy_files: { type: [String], default: [] },

    created_by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    created_by_role: { type: String, enum: ["public", "police", "ngo"], required: true },

    assigned_officer_id: { type: Schema.Types.ObjectId, ref: "User" },
    assigned_officer_role: { type: String, enum: ["police", "ngo"] },
    assigned_admin_id: { type: Schema.Types.ObjectId, ref: "User" },
    assigned_at: { type: Date },
    assigned_by: { type: Schema.Types.ObjectId, ref: "User" },

    status: { type: String, enum: ["active", "matched", "resolved"], default: "active" },
    outcome: { type: String, enum: ["ongoing", "found", "not_found"], default: "ongoing" },
    case_ref: { type: String, trim: true, unique: true, sparse: true },

    timeline: { type: [caseEventSchema], default: [] },
    notes: { type: [caseNoteSchema], default: [] },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

complaintSchema.index({ created_by: 1, created_at: -1 });
complaintSchema.index({ assigned_officer_id: 1, updated_at: -1 });
complaintSchema.index({ assigned_admin_id: 1, updated_at: -1 });
complaintSchema.index({ status: 1, created_at: -1 });

export const Complaint: Model<ComplaintInterface> = model<ComplaintInterface>("Complaint", complaintSchema);
