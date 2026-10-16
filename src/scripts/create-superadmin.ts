// One-off CLI: mint the superadmin account the HTTP surface deliberately has no
// endpoint for (see `roles.ts`). The superadmin only provisions `admin`
// accounts through `POST /api/register/admin`; it never signs into a portal.
//
//   npx tsx src/scripts/create-superadmin.ts
//
// Credentials come from the environment, so no real password is written into
// the repo or into source control:
//
//   SUPERADMIN_MOBILE      10 digits (required, used to sign in)
//   SUPERADMIN_AADHAAR     12 digits (required, used to sign in)
//   SUPERADMIN_PASSWORD    at least 6 characters (required)
//   SUPERADMIN_EMAIL       optional, also usable as a login identifier
//   SUPERADMIN_FIRST_NAME  optional, defaults to "Super"
//   SUPERADMIN_LAST_NAME   optional, defaults to "Admin"
//
// Re-runnable: an existing account for that Aadhaar/mobile is promoted to
// `superadmin`, verified, and given the supplied password, rather than tripping
// the unique index.

import "dotenv/config";
import { connectDatabase } from "../config/db.config";
import { User } from "../features/users/users.model";
import { isAadhaar, isMobile, isStrongEnough, stripNonDigits } from "../shared/validators/validators";

const required = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) {
        console.error(`[superadmin] ${name} is required.`);
        process.exit(1);
    }
    return value;
};

const create = async (): Promise<void> => {
    const mobile = stripNonDigits(required("SUPERADMIN_MOBILE"));
    const aadhaar = stripNonDigits(required("SUPERADMIN_AADHAAR"));
    const password = required("SUPERADMIN_PASSWORD");
    const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase() || undefined;
    const firstName = process.env.SUPERADMIN_FIRST_NAME?.trim() || "Super";
    const lastName = process.env.SUPERADMIN_LAST_NAME?.trim() || "Admin";

    if (!isMobile(mobile)) {
        console.error("[superadmin] SUPERADMIN_MOBILE must be 10 digits.");
        process.exit(1);
    }
    if (!isAadhaar(aadhaar)) {
        console.error("[superadmin] SUPERADMIN_AADHAAR must be 12 digits.");
        process.exit(1);
    }
    if (!isStrongEnough(password)) {
        console.error("[superadmin] SUPERADMIN_PASSWORD must be at least 6 characters.");
        process.exit(1);
    }

    const connected = await connectDatabase();
    if (!connected) {
        console.error("[superadmin] could not reach the database - nothing was created.");
        process.exitCode = 1;
        return;
    }

    const existing = await User.findOne({ $or: [{ aadhaar }, { mobile }, ...(email ? [{ email }] : [])] });

    if (existing) {
        existing.first_name = firstName;
        existing.last_name = lastName;
        existing.aadhaar = aadhaar;
        existing.mobile = mobile;
        if (email) existing.email = email;
        existing.role = "superadmin";
        existing.verification_status = "verified";
        existing.is_active = true;
        existing.password = password;
        await existing.save();
        console.log(`[superadmin] updated existing account ${existing._id} (${email ?? mobile})`);
        return;
    }

    const user = await User.create({
        first_name: firstName,
        last_name: lastName,
        aadhaar,
        mobile,
        ...(email ? { email } : {}),
        password,
        role: "superadmin",
    });

    console.log(`[superadmin] created account ${user._id}`);
};

create()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
        console.error("[superadmin] failed:", error);
        process.exit(1);
    });
