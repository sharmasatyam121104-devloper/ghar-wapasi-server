import type { ErrorDetail } from "../../shared/errors/ApiError";
import { isAadhaar, isEmail, isMobile } from "../../shared/validators/validators";
import { User } from "../users/users.model";
import { toPublicUser } from "../users/users.serializers";
import type { NgoProfile } from "../users/users.types";
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
 * An organisation's registration record and a named point of contact.
 * Fills `errors` in place; a non-empty object means the sign-up is rejected.
 */
const validateNgoProfile = (ngo: unknown, errors: ErrorDetail): NgoProfile => {
    if (!ngo || typeof ngo !== "object") {
        errors.ngo = "Organisation details are required.";
        return {};
    }

    const profile = ngo as NgoProfile;
    const required: Array<[keyof NgoProfile, string]> = [
        ["org_name", "Organisation name is required."],
        ["state", "State is required."],
        ["contact_person", "Contact person is required."],
        ["contact_mobile", "Contact mobile is required."],
    ];

    for (const [field, message] of required) {
        if (!profile[field]) errors[`ngo.${String(field)}`] = message;
    }

    if (profile.contact_mobile && !isMobile(profile.contact_mobile)) {
        errors["ngo.contact_mobile"] = "Enter a valid 10-digit mobile number.";
    }
    if (profile.contact_aadhaar && !isAadhaar(profile.contact_aadhaar)) {
        errors["ngo.contact_aadhaar"] = "Enter a valid 12-digit Aadhaar number.";
    }
    if (profile.contact_email && !isEmail(profile.contact_email)) {
        errors["ngo.contact_email"] = "Enter a valid email address.";
    }

    return profile;
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
    const ngo = validateNgoProfile(body.ngo, errors);
    assertNoFieldErrors(errors);

    await assertIdentifiersAreFree(identity.aadhaar, identity.mobile, identity.email);

    const assignedAdminId = await pickAdminForMember(ngo.state);

    const user = await User.create({
        ...identityFields(identity),
        role: "ngo",
        assigned_admin_id: assignedAdminId,
        ngo,
    });

    const tokens = await openSession(user);

    return { user: toPublicUser(user), tokens };
};
