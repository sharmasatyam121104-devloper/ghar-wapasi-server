import type { QueryFilter } from "mongoose";
import { Types } from "mongoose";
import { ApiError, type ErrorDetail } from "../../shared/errors/ApiError";
import { hashRefreshToken, issueTokens, type AuthTokens } from "../../shared/tokens/jwt";
import { isPoliceOrNgo, type UserRole } from "../../shared/types/roles";
import { User } from "../users/users.model";
import { toPublicUser } from "../users/users.serializers";
import type { NgoProfile, PoliceProfile, PublicUser, UserInterface } from "../users/users.types";
import { validateRegistration } from "./registration.validators";

/** Roles a member may sign themselves up for. `admin` is deliberately absent. */
const SELF_REGISTER_ROLES: readonly UserRole[] = ["public", "police", "ngo"];

export interface RegisterInput {
    role: UserRole;
    first_name: string;
    last_name: string;
    aadhaar: string;
    mobile: string;
    email: string;
    password: string;
    police?: PoliceProfile;
    ngo?: NgoProfile;
}

export interface RegisterResult {
    user: PublicUser;
    tokens: AuthTokens;
}

/**
 * Mirrors the frontend's `pickAdminForMember`: prefer an admin in the same
 * state, then the least loaded, then the oldest account. Deterministic, so
 * the same registration always lands with the same reviewer.
 */
const pickAdminForUser = async (state?: string): Promise<Types.ObjectId | undefined> => {
    const admins = await User.find({ role: "admin", is_active: true })
        .select("_id first_name last_name email created_at police.state ngo.state")
        .lean();

    if (admins.length === 0) return undefined;

    const stateOf = (admin: (typeof admins)[number]): string =>
        (admin.ngo?.state ?? admin.police?.state ?? "").trim();

    const sameState = state ? admins.filter((admin) => stateOf(admin) === state) : [];
    const pool = sameState.length > 0 ? sameState : admins;

    const ranked = await Promise.all(
        pool.map(async (admin) => ({
            id: admin._id as Types.ObjectId,
            createdAt: admin.created_at as Date | undefined,
            pending: await User.countDocuments({
                role: { $in: ["police", "ngo"] },
                verification_status: "pending",
                assigned_admin_id: admin._id,
            }),
        })),
    );

    ranked.sort((a, b) => {
        if (a.pending !== b.pending) return a.pending - b.pending;
        const aTime = a.createdAt?.getTime() ?? 0;
        const bTime = b.createdAt?.getTime() ?? 0;
        if (aTime !== bTime) return aTime - bTime;
        return String(a.id).localeCompare(String(b.id));
    });

    return ranked[0]?.id;
};

/**
 * Rejects a second account with the same Aadhaar, mobile or email before the
 * write happens, so the client gets a readable 409 instead of a raw Mongo
 * duplicate-key failure.
 */
const assertIdentifiersAreFree = async (
    aadhaar: string,
    mobile: string,
    email: string,
): Promise<void> => {
    const clashes: QueryFilter<UserInterface>[] = [{ aadhaar }, { mobile }];
    if (email) clashes.push({ email });

    const existing = await User.find({ $or: clashes }).select("email aadhaar mobile").lean();
    if (existing.length === 0) return;

    const errors: ErrorDetail = {};
    if (existing.some((row) => row.aadhaar === aadhaar)) {
        errors.aadhaar = "This Aadhaar number is already registered.";
    }
    if (existing.some((row) => row.mobile === mobile)) {
        errors.mobile = "This mobile number is already registered.";
    }
    if (email && existing.some((row) => row.email === email)) {
        errors.email = "This email is already registered.";
    }

    throw ApiError.conflict("An account with these details already exists.", errors);
};

export const register = async (input: RegisterInput): Promise<RegisterResult> => {
    const body = input as unknown as Record<string, unknown>;
    const role = input.role;

    if (!SELF_REGISTER_ROLES.includes(role)) {
        // An admin account must be provisioned out of band, never self-claimed.
        throw ApiError.forbidden(
            "This role cannot be self-registered. Contact an administrator.",
        );
    }

    const errors: ErrorDetail = {};
    const identity = validateRegistration(body, role, errors);
    if (Object.keys(errors).length > 0) {
        throw ApiError.unprocessable("Please fix the highlighted details.", errors);
    }

    await assertIdentifiersAreFree(identity.aadhaar, identity.mobile, identity.email);

    const police = body.police as PoliceProfile | undefined;
    const ngo = body.ngo as NgoProfile | undefined;

    const assignedAdminId = isPoliceOrNgo(role)
        ? await pickAdminForUser(police?.state ?? ngo?.state)
        : undefined;

    const user = await User.create({
        first_name: identity.first_name,
        last_name: identity.last_name,
        aadhaar: identity.aadhaar,
        mobile: identity.mobile,
        ...(identity.email ? { email: identity.email } : {}),
        password: input.password,
        role,
        assigned_admin_id: assignedAdminId,
        ...(role === "police" ? { police } : {}),
        ...(role === "ngo" ? { ngo } : {}),
    });

    const tokens = issueTokens({ _id: String(user._id), role: user.role, email: user.email });
    user.refresh_token_hash = hashRefreshToken(tokens.refreshToken);
    user.last_login = new Date();
    await user.save();

    return { user: toPublicUser(user), tokens };
};
