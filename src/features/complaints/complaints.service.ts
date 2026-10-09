import { Types } from "mongoose";
import { ApiError, type ErrorDetail } from "../../shared/errors/ApiError";
import { assertNoFieldErrors, listOfStrings } from "../registration/registration.shared";
import { assignUploadGroups, removeStoredFiles, type StorageRole } from "../files/file.storage";
import { Complaint, type ComplaintDocument } from "./complaints.model";

/**
 * Every role files a complaint the same way, so the validation and the write
 * live in `createComplaint` and the three exported functions below only pin the
 * role. The role is a literal in the function that owns it - no request can
 * talk its way into filing as another account type - and each keeps its own
 * folder (`<role>/<userId>`) on disk.
 */

const trimTo = (value: unknown, max: number): string => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

const requiredText = (value: unknown, key: string, errors: ErrorDetail, max = 300): string => {
    const text = trimTo(value, max);
    if (!text) errors[key] = "This field is required.";
    return text;
};

const digits = (value: unknown, key: string, length: number, errors: ErrorDetail): string => {
    const cleaned = String(value ?? "").replace(/\D/g, "");
    if (cleaned.length !== length) errors[key] = `Enter a valid ${length}-digit number.`;
    return cleaned;
};

const number = (value: unknown, key: string, errors: ErrorDetail): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) errors[key] = "This field is required.";
    return Number.isFinite(parsed) ? parsed : 0;
};

const date = (value: unknown, key: string, errors: ErrorDetail): Date => {
    const parsed = typeof value === "string" && value.trim() ? new Date(value) : new Date(Number.NaN);
    if (Number.isNaN(parsed.getTime())) errors[key] = "This field is required.";
    return parsed;
};

const requiredFiles = (value: unknown, key: string, errors: ErrorDetail): string[] => {
    const references = listOfStrings(value);
    if (references.length === 0) errors[key] = "At least one file is required.";
    return references;
};

const optionalFiles = (value: unknown): string[] => listOfStrings(value);

/** The cleaned body, ready to be written once the uploads have been moved. */
interface ComplaintFields {
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
}

/** Fills `errors` in place and returns the cleaned complaint body. */
const validateComplaint = (body: Record<string, unknown>, errors: ErrorDetail): ComplaintFields => ({
    person_name: requiredText(body.person_name, "person_name", errors, 120),
    person_age: number(body.person_age, "person_age", errors),
    person_gender: requiredText(body.person_gender, "person_gender", errors, 20),
    person_height: trimTo(body.person_height, 40),
    person_build: trimTo(body.person_build, 40),
    person_marks: trimTo(body.person_marks, 300),
    person_clothing: trimTo(body.person_clothing, 300),
    person_medical_notes: trimTo(body.person_medical_notes, 500),
    person_languages: trimTo(body.person_languages, 120),

    last_seen_date: date(body.last_seen_date, "last_seen_date", errors),
    last_seen_time: trimTo(body.last_seen_time, 20),
    last_seen_place: requiredText(body.last_seen_place, "last_seen_place", errors, 200),
    last_seen_city: requiredText(body.last_seen_city, "last_seen_city", errors, 120),
    last_seen_area: trimTo(body.last_seen_area, 120),
    circumstances: trimTo(body.circumstances, 1000),

    complainant_name: requiredText(body.complainant_name, "complainant_name", errors, 120),
    complainant_relation: requiredText(body.complainant_relation, "complainant_relation", errors, 60),
    complainant_aadhaar: digits(body.complainant_aadhaar, "complainant_aadhaar", 12, errors),
    complainant_mobile: digits(body.complainant_mobile, "complainant_mobile", 10, errors),
    complainant_address: requiredText(body.complainant_address, "complainant_address", errors, 500),

    member_name: requiredText(body.member_name, "member_name", errors, 120),
    member_relation: requiredText(body.member_relation, "member_relation", errors, 60),
    member_aadhaar: digits(body.member_aadhaar, "member_aadhaar", 12, errors),
    member_mobile: digits(body.member_mobile, "member_mobile", 10, errors),

    police_station: requiredText(body.police_station, "police_station", errors, 120),
    fir_number: requiredText(body.fir_number, "fir_number", errors, 60),
    fir_date: date(body.fir_date, "fir_date", errors),

    person_photos: requiredFiles(body.person_photos, "person_photos", errors),
    location_photos: optionalFiles(body.location_photos),
    complainant_id_files: requiredFiles(body.complainant_id_files, "complainant_id_files", errors),
    member_id_files: requiredFiles(body.member_id_files, "member_id_files", errors),
    fir_copy_files: requiredFiles(body.fir_copy_files, "fir_copy_files", errors),
});

/**
 * A human-readable reference in the same `GW-<year>-<nnnn>` shape the clients
 * already display. Random rather than sequential so a busy year does not make
 * the number a count of cases, and checked against the unique index first so
 * the create never fails on a duplicate.
 */
const makeCaseRef = async (): Promise<string> => {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const suffix = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
        const reference = `GW-${year}-${suffix}`;
        if (!(await Complaint.exists({ case_ref: reference }))) return reference;
    }
    throw ApiError.serviceUnavailable("Could not allocate a case reference. Please try again.");
};

/**
 * The one path every complaint takes: validate, move the `tmp/*` uploads into
 * the member's folder, then write. If the write fails the moved files are put
 * back out of the way, so a failed request never strands a document.
 */
const createComplaint = async (
    role: StorageRole,
    actorId: string,
    body: Record<string, unknown>,
): Promise<ComplaintDocument> => {
    const errors: ErrorDetail = {};
    const fields = validateComplaint(body, errors);
    assertNoFieldErrors(errors);

    const stored = await assignUploadGroups(role, actorId, {
        person_photos: fields.person_photos,
        location_photos: fields.location_photos,
        complainant_id_files: fields.complainant_id_files,
        member_id_files: fields.member_id_files,
        fir_copy_files: fields.fir_copy_files,
    });

    const case_ref = await makeCaseRef();

    try {
        return await Complaint.create({
            case_ref,
            ...fields,
            person_photos: stored.person_photos,
            location_photos: stored.location_photos,
            complainant_id_files: stored.complainant_id_files,
            member_id_files: stored.member_id_files,
            fir_copy_files: stored.fir_copy_files,
            created_by: new Types.ObjectId(actorId),
            created_by_role: role,
            status: "active",
            timeline: [
                {
                    title: "Complaint filed",
                    date: new Date(),
                    detail: "The complaint has been received and is now with the assigned team.",
                    state: "done",
                },
            ],
        });
    } catch (error) {
        removeStoredFiles([
            ...(stored.person_photos ?? []),
            ...(stored.location_photos ?? []),
            ...(stored.complainant_id_files ?? []),
            ...(stored.member_id_files ?? []),
            ...(stored.fir_copy_files ?? []),
        ]);
        throw error;
    }
};

export const registerPublicComplaint = (userId: string, body: Record<string, unknown>): Promise<ComplaintDocument> =>
    createComplaint("public", userId, body);

export const registerPoliceComplaint = (userId: string, body: Record<string, unknown>): Promise<ComplaintDocument> =>
    createComplaint("police", userId, body);

export const registerNgoComplaint = (userId: string, body: Record<string, unknown>): Promise<ComplaintDocument> =>
    createComplaint("ngo", userId, body);
