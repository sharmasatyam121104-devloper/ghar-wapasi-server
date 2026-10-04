import type { ErrorDetail } from "../../shared/errors/ApiError";
import { User } from "../users/users.model";
import { toPublicUser } from "../users/users.serializers";
import {
    assertIdentifiersAreFree,
    assertNoFieldErrors,
    identityFields,
    openSession,
    validateIdentity,
    type RegisterResult,
} from "./registration.shared";

/**
 * A member of the public. Open to anyone, no extra fields, and usable the
 * moment it is created - the model hook starts it `verified`.
 *
 * Email is optional here and on the admin form: both are collected the same
 * way, so both are reachable by mobile alone.
 */
export const registerPublic = async (body: Record<string, unknown>): Promise<RegisterResult> => {
    const errors: ErrorDetail = {};

    const identity = validateIdentity(
        body,
        { requireEmail: false, emailHint: "An email address is required." },
        errors,
    );
    assertNoFieldErrors(errors);

    await assertIdentifiersAreFree(identity.aadhaar, identity.mobile, identity.email);

    const user = await User.create({ ...identityFields(identity), role: "public" });

    const tokens = await openSession(user);

    return { user: toPublicUser(user), tokens };
};
