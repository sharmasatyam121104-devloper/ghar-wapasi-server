import { Types } from "mongoose";
import type { ErrorDetail } from "../../shared/errors/ApiError";
import { isAadhaar, isEmail, isMobile } from "../../shared/validators/validators";
import { assignUploadGroups, deleteUserDirectory } from "../files/file.storage";
import { User, type UserDocument } from "../users/users.model";
import { toPublicUser } from "../users/users.serializers";
import type { NgoProfile } from "../users/users.types";
import {
    assertIdentifiersAreFree,
    assertNoFieldErrors,
    identityFields,
    listOfStrings,
    openSession,
    pickAdminForMember,
    validateIdentity,
    type RegisterResult,
} from "./registration.shared";

/** The organisation record plus the `tmp/*` file references that become its files. */
interface NgoProfileInput {
    profile: NgoProfile;
    registrationUploads: string[];
    photoUploads: string[];
}

/**
 * An organisation's registration record and a named point of contact.
 * Fills `errors` in place; a non-empty object means the sign-up is rejected.
 */
const validateNgoProfile = (ngo: unknown, errors: ErrorDetail): NgoProfileInput => {
    if (!ngo || typeof ngo !== "object") {
        errors.ngo = "Organisation details are required.";
        return { profile: {}, registrationUploads: [], photoUploads: [] };
    }

    const input = ngo as Record<string, unknown>;
    const required: Array<[keyof NgoProfile, string]> = [
        ["org_name", "Organisation name is required."],
        ["state", "State is required."],
        ["contact_person", "Contact person is required."],
        ["contact_mobile", "Contact mobile is required."],
    ];

    for (const [field, message] of required) {
        if (!input[field]) errors[`ngo.${String(field)}`] = message;
    }

    const contactMobile = typeof input.contact_mobile === "string" ? input.contact_mobile : "";
    if (contactMobile && !isMobile(contactMobile)) {
        errors["ngo.contact_mobile"] = "Enter a valid 10-digit mobile number.";
    }
    const contactAadhaar = typeof input.contact_aadhaar === "string" ? input.contact_aadhaar : "";
    if (contactAadhaar && !isAadhaar(contactAadhaar)) {
        errors["ngo.contact_aadhaar"] = "Enter a valid 12-digit Aadhaar number.";
    }
    const contactEmail = typeof input.contact_email === "string" ? input.contact_email : "";
    if (contactEmail && !isEmail(contactEmail)) {
        errors["ngo.contact_email"] = "Enter a valid email address.";
    }

    // Upload references are transport, not record: keep them out of the profile.
    const { reg_certificate_uploads: _certificate, org_photo_uploads: _photos, ...profile } = input;

    return {
        profile: profile as NgoProfile,
        registrationUploads: listOfStrings(input.reg_certificate_uploads),
        photoUploads: listOfStrings(input.org_photo_uploads),
    };
};

/**
 * Creates the account `pending` and hands it to an admin to review.
 * `contact_mobile` is how the admin reaches the organisation during the viva.
 */
export const registerNgo = async (body: Record<string, unknown>): Promise<RegisterResult> => {
    const errors: ErrorDetail = {};

    const identity = validateIdentity(
        body,
        {
            requireEmail: true,
            emailHint: "An email address is required for police and NGO accounts.",
        },
        errors,
    );
    const { profile, registrationUploads, photoUploads } = validateNgoProfile(body.ngo, errors);
    assertNoFieldErrors(errors);

    await assertIdentifiersAreFree(identity.aadhaar, identity.mobile, identity.email);

    const assignedAdminId = await pickAdminForMember(profile.state);

    // Same as police: mint the id, move the files, then write the row - and
    // take the files back off disk if that write fails.
    const userId = new Types.ObjectId();
    const stored = await assignUploadGroups("ngo", String(userId), {
        reg_certificate_files: registrationUploads,
        org_photo_files: photoUploads,
    });

    let user: UserDocument;
    try {
        user = await User.create({
            _id: userId,
            ...identityFields(identity),
            role: "ngo",
            assigned_admin_id: assignedAdminId,
            ngo: {
                ...profile,
                reg_certificate_files: stored.reg_certificate_files,
                org_photo_files: stored.org_photo_files,
            },
        });
    } catch (error) {
        deleteUserDirectory("ngo", String(userId));
        throw error;
    }

    const tokens = await openSession(user);

    return { user: toPublicUser(user), tokens };
};
