import type { ErrorDetail } from "../../shared/errors/ApiError";
import { User } from "../users/users.model";
import { toPublicUser } from "../users/users.serializers";
import type { PublicUser } from "../users/users.types";
import {
    assertIdentifiersAreFree,
    assertNoFieldErrors,
    identityFields,
    validateIdentity,
} from "./registration.shared";

/**
 * Deliberately no `tokens` here, unlike every other registration service.
 *
 * The other three endpoints are self-service: the caller is the person who just
 * signed up, so handing them a session is the whole point. This one is not - the
 * caller is a superadmin creating an account for somebody else. Returning a
 * live session would mean shipping the superadmin a way to act as the admin they
 * just made, and setting the cookies would silently log the superadmin out of
 * their own browser mid-task. The new admin signs in for themselves.
 */
export interface AdminProvisioned {
    user: PublicUser;
}

/**
 * Creates an `admin` account. Same fields as the public sign-up form and
 * nothing more - an admin has no police or NGO record to verify.
 *
 * The route behind this is gated by `requireSuperAdmin`, so this service is
 * only ever reached by a superadmin. The role is a literal in the `create` call
 * rather than something read off the body: there is no code path here where a
 * caller-supplied value decides what gets written.
 *
 * The account starts `verified` via the model hook, so it can sign in and use
 * the review console immediately - it does not queue behind anyone.
 */
export const registerAdmin = async (body: Record<string, unknown>): Promise<AdminProvisioned> => {
    const errors: ErrorDetail = {};

    const identity = validateIdentity(
        body,
        { requireEmail: false, emailHint: "An email address is required." },
        errors,
    );
    assertNoFieldErrors(errors);

    await assertIdentifiersAreFree(identity.aadhaar, identity.mobile, identity.email);

    const user = await User.create({ ...identityFields(identity), role: "admin" });

    return { user: toPublicUser(user) };
};
