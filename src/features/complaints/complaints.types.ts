import type { Types } from "mongoose";

export type ComplaintStatus = "active" | "matched" | "resolved";

export interface CaseEvent {
  title: string;
  date: Date;
  detail: string;
  state: "done" | "current" | "pending";
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

  status: ComplaintStatus;
  case_ref?: string;

  timeline: CaseEvent[];

  created_at: Date;
  updated_at: Date;
}
