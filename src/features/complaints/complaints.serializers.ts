import { maskAadhaar } from "../../shared/validators/validators";
import type { ComplaintDocument } from "./complaints.model";

/**
 * A complaint as the API hands it back. `_id` becomes `id` like every other
 * resource, the Aadhaar numbers are masked, and Mongoose's `__v` never leaves
 * the server. The stored file paths stay in place - they are what
 * `GET /api/files/{role}/{userId}/{filename}` serves.
 */
export interface PublicComplaint {
    id: string;
    case_ref: string;
    status: string;
    created_by: string;
    created_by_role: string;

    person_name: string;
    person_age: number;
    person_gender: string;
    person_height: string;
    person_build: string;
    person_marks: string;
    person_clothing: string;
    person_medical_notes: string;
    person_languages: string;

    last_seen_date: Date;
    last_seen_time: string;
    last_seen_place: string;
    last_seen_city: string;
    last_seen_area: string;
    circumstances: string;

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

    timeline: { title: string; date: Date; detail: string; state: string }[];

    created_at?: Date;
    updated_at?: Date;
}

export const toPublicComplaint = (complaint: ComplaintDocument): PublicComplaint => ({
    id: String(complaint._id),
    case_ref: complaint.case_ref ?? "",
    status: complaint.status,
    created_by: String(complaint.created_by),
    created_by_role: complaint.created_by_role,

    person_name: complaint.person_name,
    person_age: complaint.person_age,
    person_gender: complaint.person_gender,
    person_height: complaint.person_height ?? "",
    person_build: complaint.person_build ?? "",
    person_marks: complaint.person_marks ?? "",
    person_clothing: complaint.person_clothing ?? "",
    person_medical_notes: complaint.person_medical_notes ?? "",
    person_languages: complaint.person_languages ?? "",

    last_seen_date: complaint.last_seen_date,
    last_seen_time: complaint.last_seen_time ?? "",
    last_seen_place: complaint.last_seen_place,
    last_seen_city: complaint.last_seen_city,
    last_seen_area: complaint.last_seen_area ?? "",
    circumstances: complaint.circumstances ?? "",

    complainant_name: complaint.complainant_name,
    complainant_relation: complaint.complainant_relation,
    complainant_aadhaar: maskAadhaar(complaint.complainant_aadhaar),
    complainant_mobile: complaint.complainant_mobile,
    complainant_address: complaint.complainant_address,

    member_name: complaint.member_name,
    member_relation: complaint.member_relation,
    member_aadhaar: maskAadhaar(complaint.member_aadhaar),
    member_mobile: complaint.member_mobile,

    police_station: complaint.police_station,
    fir_number: complaint.fir_number,
    fir_date: complaint.fir_date,

    person_photos: complaint.person_photos ?? [],
    location_photos: complaint.location_photos ?? [],
    complainant_id_files: complaint.complainant_id_files ?? [],
    member_id_files: complaint.member_id_files ?? [],
    fir_copy_files: complaint.fir_copy_files ?? [],

    timeline: (complaint.timeline ?? []).map((event) => ({
        title: event.title,
        date: event.date,
        detail: event.detail,
        state: event.state,
    })),

    created_at: complaint.created_at,
    updated_at: complaint.updated_at,
});
