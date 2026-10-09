import { maskAadhaar } from "../../shared/validators/validators";
import type { VerificationStatus } from "../../shared/types/verification";
import type { UserDocument } from "./users.model";
import type { NgoProfile, PoliceProfile, PublicUser, UserInterface } from "./users.types";

/** Turns a Mongoose subdocument into a plain object safe to spread. */
export const plain = <T>(value: unknown): T | undefined => {
    if (!value) return undefined;
    const doc = value as { toObject?: () => T };
    return typeof doc.toObject === "function" ? doc.toObject() : (value as T);
};

export const toPublicUser = (user: UserDocument | UserInterface): PublicUser => ({
    id: String(user._id),
    name: `${user.first_name} ${user.last_name}`.trim(),
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    // Public accounts may have no email, so fall back to the mobile number.
    identifier: user.email || user.mobile,
    email: user.email,
    aadhaar_masked: maskAadhaar(user.aadhaar),
    mobile: user.mobile,
    // The frontend scopes its whole admin console on this value.
    adminId: user.role === "admin" ? String(user._id) : "",
    verification_status: user.verification_status,
    is_active: user.is_active,
});

export interface VerificationRecord extends PublicUser {
    aadhaar: string;
    state: string;
    location: string;
    organisation: string;
    roleLabel: string;
    status: VerificationStatus;
    documents: string[];
    submitted_at?: Date;
    rejection_reason?: string;
    reviewed_at?: Date;
    assigned_admin_id: string | null;
    profile: PoliceProfile | NgoProfile | undefined;
    /**
     * What the member is asking to change, and when each part was proved. The
     * admin cannot sensibly judge a request they cannot read, so this is part of
     * the record rather than something the UI has to fetch separately.
     */
    pending_contact: {
        email?: string;
        mobile?: string;
        email_otp_verified_at?: Date;
        mobile_otp_verified_at?: Date;
        requested_at?: Date;
    } | null;
    verification_call: {
        link?: string;
        time?: Date;
        note?: string;
        scheduled_by?: string;
        scheduled_at?: Date;
    } | null;
}

/**
 * The profile as the admin reads it. Raw file paths are split out into
 * `documents`, and the NGO contact Aadhaar is masked - what stays here are the
 * service/organisation details themselves.
 */
const reviewProfile = (user: UserDocument): PoliceProfile | NgoProfile | undefined => {
    if (user.role === "police") {
        const police = plain<PoliceProfile>(user.police);
        if (!police) return undefined;
        const { id_card_files: _idCardFiles, appointment_proof_files: _appointmentProofFiles, ...rest } = police;
        return rest;
    }

    if (user.role === "ngo") {
        const ngo = plain<NgoProfile>(user.ngo);
        if (!ngo) return undefined;
        const { reg_certificate_files: _certificateFiles, org_photo_files: _orgPhotoFiles, contact_aadhaar, ...rest } = ngo;
        return contact_aadhaar ? { ...rest, contact_aadhaar: maskAadhaar(contact_aadhaar) } : rest;
    }

    return undefined;
};

/** The staff-facing detail view - what an admin checks the documents against. */
export const toVerificationRecord = (user: UserDocument): VerificationRecord => {
    const isPolice = user.role === "police";
    const isNgo = user.role === "ngo";

    const files = isPolice
        ? [...(user.police?.id_card_files ?? []), ...(user.police?.appointment_proof_files ?? [])]
        : isNgo
          ? [...(user.ngo?.reg_certificate_files ?? []), ...(user.ngo?.org_photo_files ?? [])]
          : [];

    const state = (isPolice ? user.police?.state : user.ngo?.state) ?? "";
    const location = isNgo
        ? [user.ngo?.city, user.ngo?.district].filter(Boolean).join(", ") || "—"
        : [user.police?.station_name, user.police?.district].filter(Boolean).join(", ") || "—";
    const organisation = isNgo ? (user.ngo?.org_name ?? "") : (user.police?.station_name ?? "");

    const call = user.verification_call;

    return {
        ...toPublicUser(user),
        aadhaar: maskAadhaar(user.aadhaar),
        state,
        location,
        organisation,
        roleLabel: isPolice ? "Police Officer" : "NGO Member",
        status: user.verification_status,
        documents: files,
        submitted_at: user.submitted_at,
        rejection_reason: user.rejection_reason,
        reviewed_at: user.reviewed_at,
        assigned_admin_id: user.assigned_admin_id ? String(user.assigned_admin_id) : null,
        profile: reviewProfile(user),
        pending_contact: user.pending_contact
            ? {
                  email: user.pending_contact.email,
                  mobile: user.pending_contact.mobile,
                  email_otp_verified_at: user.pending_contact.email_otp_verified_at,
                  mobile_otp_verified_at: user.pending_contact.mobile_otp_verified_at,
                  requested_at: user.pending_contact.requested_at,
              }
            : null,
        verification_call: call
            ? {
                  link: call.link,
                  time: call.time,
                  note: call.note,
                  scheduled_by: call.scheduled_by ? String(call.scheduled_by) : undefined,
                  scheduled_at: call.scheduled_at,
              }
            : null,
    };
};
