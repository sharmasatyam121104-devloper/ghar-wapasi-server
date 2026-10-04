import type { Types } from "mongoose";
import type { UserRole } from "../../shared/types/roles";
import type { VerificationStatus } from "../../shared/types/verification";

/** Mirrors the frontend's `callSlots` - the admin picks a slot, never the user. */
export interface VerificationCall {
    link?: string;
    time?: Date;
    note?: string;
    scheduled_by?: Types.ObjectId;
    scheduled_at?: Date;
}

export interface PoliceProfile {
    rank?: string;
    badge_number?: string;
    station_name?: string;
    district?: string;
    state?: string;
    official_email?: string;
    employee_id?: string;
    joining_date?: Date;
    reporting_officer?: string;
    reporting_officer_contact?: string;
    id_card_files?: string[];
    appointment_proof_files?: string[];
}

export interface NgoProfile {
    org_name?: string;
    org_type?: string;
    reg_number?: string;
    state?: string;
    district?: string;
    city?: string;
    address?: string;
    contact_person?: string;
    designation?: string;
    contact_mobile?: string;
    contact_email?: string;
    website?: string;
    contact_aadhaar?: string;
    reg_certificate_files?: string[];
    org_photo_files?: string[];
}

export interface UserInterface {
    _id: Types.ObjectId;

    first_name: string;
    last_name: string;

    aadhaar: string;
    mobile: string;
    email: string;
    password: string;

    role: UserRole;

    /** Frontend `Session.adminId` - the id an admin scopes their console to. */
    assigned_admin_id?: Types.ObjectId;

    police?: PoliceProfile;
    ngo?: NgoProfile;

    verification_status: VerificationStatus;
    submitted_at?: Date;
    rejection_reason?: string;
    reviewed_by?: Types.ObjectId;
    reviewed_at?: Date;
    verification_call?: VerificationCall;

    /** Nulled out after a forced sign-out, so refresh tokens cannot be replayed. */
    refresh_token_hash?: string | null;
    password_changed_at?: Date;
    last_login?: Date;

    is_active: boolean;

    created_at: Date;
    updated_at: Date;
}

/** Shape the login/me endpoints return. Mirrors the frontend `Session`. */
export interface PublicUser {
    id: string;
    name: string;
    first_name: string;
    last_name: string;
    role: UserRole;
    identifier: string;
    email: string;
    aadhaar_masked: string;
    mobile: string;
    adminId: string;
    verification_status: VerificationStatus;
    is_active: boolean;
}
