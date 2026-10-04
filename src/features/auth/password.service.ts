import bcrypt from "bcryptjs";
import { ApiError, type ErrorDetail } from "../../shared/errors/ApiError";
import { isStrongEnough } from "../../shared/validators/validators";
import { User, type UserDocument } from "../users/users.model";

/**
 * Changing a password must prove you know the current one, and it silently
 * signs out every other device.
 */
export const changePassword = async (
    user: UserDocument,
    current: unknown,
    next: unknown,
): Promise<void> => {
    const errors: ErrorDetail = {};

    if (typeof current !== "string" || !current) {
        errors.current_password = "Your current password is required.";
    }
    if (typeof next !== "string" || !next) {
        errors.new_password = "A new password is required.";
    } else if (!isStrongEnough(next)) {
        errors.new_password = "Password must be at least 6 characters.";
    }
    if (typeof current === "string" && typeof next === "string" && next && next === current) {
        errors.new_password = "The new password must be different from the current one.";
    }

    if (Object.keys(errors).length > 0) {
        throw ApiError.unprocessable("Please fix the highlighted details.", errors);
    }

    const stored = await User.findById(user._id).select("+password");
    if (!stored) throw ApiError.notFound("That account could not be found.");

    const matches = await bcrypt.compare(current as string, stored.password);
    if (!matches) {
        throw ApiError.unprocessable("Your current password is incorrect.", {
            current_password: "Your current password is incorrect.",
        });
    }

    // The pre-save hook re-hashes and clears refresh_token_hash, so signing
    // out every other session for this account comes for free.
    stored.password = next as string;
    await stored.save();
};
