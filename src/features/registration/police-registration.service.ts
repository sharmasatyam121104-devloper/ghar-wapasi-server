import type { ErrorDetail } from "../../shared/errors/ApiError";
import { isEmail } from "../../shared/validators/validators";
import { User } from "../users/users.model";
import { toPublicUser } from "../users/users.serializers";
import type { PoliceProfile } from "../users/users.types";
import {
    assertIdentifiersAreFree,
    assertNoFieldErrors,
    identityFields,
    openSession,
    pickAdminForMember,
    validateIdentity,
    type RegisterResult,
} from "./registration.shared";

/**
 * An officer's service record plus at least one ID card photo to verify.
 * Fills `errors` in place; a non-empty object means the sign-up is rejected.
 */
const validatePoliceProfile = (police: unknown, errors: ErrorDetail): PoliceProfile => {
    if (!police || typeof police !== "object") {
        errors.police = "Police service details are required.";
        return {};
    }

    const profile = police as PoliceProfile;
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
        if (!profile[field]) errors[`police.${String(field)}`] = message;
    }

    if (!profile.official_email) {
        errors["police.official_email"] = "Official email is required.";
    } else if (!isEmail(profile.official_email)) {
        errors["police.official_email"] = "Enter a valid official email address.";
    }

    if (!profile.id_card_files?.length) {
        errors["police.id_card_files"] = "At least one ID card photo is required.";
    }

    return profile;
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
    const police = validatePoliceProfile(body.police, errors);
    assertNoFieldErrors(errors);

    await assertIdentifiersAreFree(identity.aadhaar, identity.mobile, identity.email);

    const assignedAdminId = await pickAdminForMember(police.state);

    const user = await User.create({
        ...identityFields(identity),
        role: "police",
        assigned_admin_id: assignedAdminId,
        police,
    });

    const tokens = await openSession(user);

    return { user: toPublicUser(user), tokens };
};
