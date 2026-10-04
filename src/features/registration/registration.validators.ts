import type { ErrorDetail } from "../../shared/errors/ApiError";
import type { UserRole } from "../../shared/types/roles";
import { requiredField } from "../../shared/validators/fields";
import {
    isAadhaar,
    isEmail,
    isMobile,
    isStrongEnough,
    normalizeEmail,
    stripNonDigits,
} from "../../shared/validators/validators";
import type { NgoProfile, PoliceProfile } from "../users/users.types";

/**
 * Every field rule for a sign-up, in one place. Nothing here touches the
 * database, so the whole form is validated in a single pass and the client
 * gets one 422 listing every problem instead of one error per round trip.
 */

/** The identity fields, cleaned up and ready to store. */
export interface NormalizedRegistration {
    first_name: string;
    last_name: string;
    aadhaar: string;
    mobile: string;
    email: string;
    /** Only ever returned once it has passed `isStrongEnough`. */
    password: string;
}

/** An officer's service record plus at least one ID card photo to verify. */
const validatePoliceProfile = (police: unknown, errors: ErrorDetail): void => {
    if (!police || typeof police !== "object") {
        errors.police = "Police service details are required.";
        return;
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
};

/** An organisation's registration record and a named point of contact. */
const validateNgoProfile = (ngo: unknown, errors: ErrorDetail): void => {
    if (!ngo || typeof ngo !== "object") {
        errors.ngo = "Organisation details are required.";
        return;
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
};

/**
 * Fills `errors` in place and returns the cleaned identity fields.
 * A non-empty `errors` object means the sign-up must not be saved.
 */
export const validateRegistration = (
    body: Record<string, unknown>,
    role: UserRole,
    errors: ErrorDetail,
): NormalizedRegistration => {
    const firstName = requiredField(body.first_name, "first_name", errors);
    const lastName = requiredField(body.last_name, "last_name", errors);

    const aadhaarRaw = requiredField(body.aadhaar, "aadhaar", errors);
    if (aadhaarRaw && !isAadhaar(aadhaarRaw)) {
        errors.aadhaar = "Enter a valid 12-digit Aadhaar number.";
    }

    const mobileRaw = requiredField(body.mobile, "mobile", errors);
    if (mobileRaw && !isMobile(mobileRaw)) {
        errors.mobile = "Enter a valid 10-digit mobile number.";
    }

    // Public sign-up does not collect an email; staff registrations do.
    const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
    if (emailRaw && !isEmail(emailRaw)) {
        errors.email = "Enter a valid email address.";
    }
    if (role !== "public" && !emailRaw) {
        errors.email = "An email address is required for police and NGO accounts.";
    }

    const password = typeof body.password === "string" ? body.password : "";
    if (!password) {
        errors.password = "Password is required.";
    } else if (!isStrongEnough(password)) {
        errors.password = "Password must be at least 6 characters.";
    }

    if (role === "police") validatePoliceProfile(body.police, errors);
    if (role === "ngo") validateNgoProfile(body.ngo, errors);

    return {
        first_name: firstName,
        last_name: lastName,
        aadhaar: stripNonDigits(aadhaarRaw),
        mobile: stripNonDigits(mobileRaw),
        email: emailRaw ? normalizeEmail(emailRaw) : "",
        password,
    };
};
