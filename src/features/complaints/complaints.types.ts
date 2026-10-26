import type { Types } from "mongoose";

export type ComplaintStatus = "active" | "matched" | "resolved";
export type CaseOutcome = "ongoing" | "found" | "not_found";

export interface CaseEvent {
  title: string;
  date: Date;
  detail: string;
  state: "done" | "current" | "pending";
}

export interface CaseNote {
  _id: Types.ObjectId;
  author_id: Types.ObjectId;
  author_name: string;
  author_role: string;
  body: string;
  created_at: Date;
}

export interface ComplaintInterface {
  _id: Types.ObjectId;

  person_name: string;
  person_age: number;
  person_gender: string;
  person_height?: string;
  person_build?: string;
  person_marks?: string;
  person_clothing?: string;
  person_medical_notes?: string;
  person_languages?: string;

  last_seen_date: Date;
  last_seen_time?: string;
  last_seen_place: string;
  last_seen_city: string;
  last_seen_area?: string;
  circumstances?: string;

  complainant_name: string;
  complainant_relation: string;
  complainant_aadhaar: string;
  complainant_mobile: string;
  complainant_address: string;

  member_name: string;
  member_relation: string;
  member_aadhaar: string;
  member_mobile: string;

  police_station: string;
  fir_number: string;
  fir_date: Date;

  person_photos: string[];
  location_photos: string[];
  complainant_id_files: string[];
  member_id_files: string[];
  fir_copy_files: string[];

  created_by: Types.ObjectId;
  created_by_role: "public" | "police" | "ngo";

  assigned_officer_id?: Types.ObjectId;
  assigned_officer_role?: "police" | "ngo";
  assigned_admin_id?: Types.ObjectId;
  assigned_at?: Date;
  assigned_by?: Types.ObjectId;

  status: ComplaintStatus;
  outcome: CaseOutcome;
  case_ref?: string;

  timeline: CaseEvent[];
  notes: CaseNote[];

  created_at: Date;
  updated_at: Date;
}
