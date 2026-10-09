import { Types } from "mongoose";
import type { ErrorDetail } from "../../shared/errors/ApiError";
import { isEmail } from "../../shared/validators/validators";
import { assignUploadGroups, deleteUserDirectory } from "../files/file.storage";
import { User, type UserDocument } from "../users/users.model";
import { toPublicUser } from "../users/users.serializers";
import type { PoliceProfile } from "../users/users.types";
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

/** The service record plus the `tmp/*` photo references that become its files. */
interface PoliceProfileInput {
    profile: PoliceProfile;
    idCardUploads: string[];
    appointmentUploads: string[];
}

/**
 * An officer's service record plus at least one ID card photo to verify.
 * Fills `errors` in place; a non-empty object means the sign-up is rejected.
 */
const validatePoliceProfile = (police: unknown, errors: ErrorDetail): PoliceProfileInput => {
    if (!police || typeof police !== "object") {
        errors.police = "Police service details are required.";
        return { profile: {}, idCardUploads: [], appointmentUploads: [] };
    }

    const input = police as Record<string, unknown>;
    const required: Array<[keyof PoliceProfile, string]> = [
        ["rank", "Rank is required."],
        ["badge_number", "Badge number is required."],
        ["station_name", "Station name is required."],
        ["state", "State is required."],
        ["employee_id", "Employee ID is required."],
        ["joining_date", "Joining date is required."],
        ["reporting_officer", "Reporting officer is required."],
    ];

    for (const [field, message] of required) {
        if (!input[field]) errors[`police.${String(field)}`] = message;
    }

    const officialEmail = typeof input.official_email === "string" ? input.official_email : "";
    if (!officialEmail) {
        errors["police.official_email"] = "Official email is required.";
    } else if (!isEmail(officialEmail)) {
        errors["police.official_email"] = "Enter a valid official email address.";
    }

    const idCardUploads = listOfStrings(input.id_card_uploads);
    if (idCardUploads.length === 0) {
        errors["police.id_card_files"] = "At least one ID card photo is required.";
    }

    // Upload references are transport, not record: keep them out of the profile.
    const { id_card_uploads: _idCard, appointment_proof_uploads: _appointment, ...profile } = input;

    return {
        profile: profile as PoliceProfile,
        idCardUploads,
        appointmentUploads: listOfStrings(input.appointment_proof_uploads),
    };
};

/**
 * Creates the account `pending` and hands it to an admin to review. The
 * `id_card_files` photo is what the admin checks against, which is why it is
 * required rather than optional.
 */
export const registerPolice = async (body: Record<string, unknown>): Promise<RegisterResult> => {
    const errors: ErrorDetail = {};

    const identity = validateIdentity(
        body,
        {
            requireEmail: true,
            emailHint: "An email address is required for police and NGO accounts.",
        },
        errors,
    );
    const { profile, idCardUploads, appointmentUploads } = validatePoliceProfile(body.police, errors);
    assertNoFieldErrors(errors);

    await assertIdentifiersAreFree(identity.aadhaar, identity.mobile, identity.email);

    const assignedAdminId = await pickAdminForMember(profile.state);

    // The member id is minted first so the files have a folder to move into.
    // `assignUploadGroups` cleans up after itself on failure; the user write
    // gets the same treatment so a rejected sign-up leaves nothing on disk.
    const userId = new Types.ObjectId();
    const stored = await assignUploadGroups("police", String(userId), {
        id_card_files: idCardUploads,
        appointment_proof_files: appointmentUploads,
    });

    let user: UserDocument;
    try {
        user = await User.create({
            _id: userId,
            ...identityFields(identity),
            role: "police",
            assigned_admin_id: assignedAdminId,
            police: {
                ...profile,
                id_card_files: stored.id_card_files,
                appointment_proof_files: stored.appointment_proof_files,
            },
        });
    } catch (error) {
        deleteUserDirectory("police", String(userId));
        throw error;
    }

    const tokens = await openSession(user);

    return { user: toPublicUser(user), tokens };
};
