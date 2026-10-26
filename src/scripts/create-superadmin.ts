// One-off CLI: mint the superadmin account the HTTP surface deliberately has no
// endpoint for (see `roles.ts`). A superadmin signs into the admin console with
// global scope and provisions `admin` accounts through `POST /api/register/admin`.
//
//   npm run superadmin
//
// Everything is typed at the prompt - name, email, mobile, Aadhaar and password
// are never read from environment variables, so a real credential does not have
// to be written into a shell profile or `.env`.
//
// Re-runnable: an existing account for that Aadhaar/mobile/email is promoted to
// `superadmin`, verified, and given the supplied password, rather than tripping
// the unique index.

import "dotenv/config";
import { createInterface, type Interface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { connectDatabase } from "../config/db.config";
import { User } from "../features/users/users.model";
import {
    isAadhaar,
    isEmail,
    isMobile,
    isStrongEnough,
    normalizeEmail,
    stripNonDigits,
} from "../shared/validators/validators";

interface PromptReader {
    next: () => Promise<string>;
}

/**
 * A line queue rather than `rl.question`: readline emits every line at once
 * when input is piped, and a question registered after an `await` can miss the
 * next line. Queueing the line events keeps interactive typing and piped input
 * on the same path.
 */
const lineReader = (rl: Interface): PromptReader => {
    const buffered: string[] = [];
    const waiting: Array<{
        resolve: (line: string) => void;
        reject: (error: Error) => void;
    }> = [];

    rl.on("line", (line) => {
        const waiter = waiting.shift();
        if (waiter) waiter.resolve(line);
        else buffered.push(line);
    });

    rl.on("close", () => {
        for (const waiter of waiting.splice(0)) {
            waiter.reject(new Error("Input closed before all answers were entered."));
        }
    });

    return {
        next: () => {
            const line = buffered.shift();
            if (line !== undefined) return Promise.resolve(line);
            return new Promise((resolve, reject) => {
                waiting.push({ resolve, reject });
            });
        },
    };
};

const ask = async (
    reader: PromptReader,
    prompt: string,
    validate: (value: string) => string | null,
): Promise<string> => {
    for (;;) {
        output.write(prompt);
        const answer = (await reader.next()).trim();
        const error = validate(answer);
        if (!error) return answer;
        console.error(`  ${error}`);
    }
};

/**
 * readline has no "hide input" option. Muting its echo writer keeps the typed
 * password off the terminal while the line queue keeps reading normally.
 */
const askHidden = async (
    rl: Interface,
    reader: PromptReader,
    prompt: string,
    validate: (value: string) => string | null,
): Promise<string> => {
    for (;;) {
        output.write(prompt);
        const muteable = rl as unknown as { _writeToOutput: (text: string) => void };
        const originalWriter = muteable._writeToOutput;
        muteable._writeToOutput = () => {};
        let answer = "";
        try {
            answer = (await reader.next()).trim();
        } finally {
            muteable._writeToOutput = originalWriter;
            output.write("\n");
        }

        const error = validate(answer);
        if (!error) return answer;
        console.error(`  ${error}`);
    }
};

const create = async (): Promise<void> => {
    const rl = createInterface({ input, output });
    const reader = lineReader(rl);
    rl.on("SIGINT", () => {
        output.write("\n");
        rl.close();
        process.exit(130);
    });

    try {
        const firstName = await ask(reader, "First name: ", (value) =>
            value ? null : "First name is required.",
        );
        const lastName = await ask(reader, "Last name: ", (value) =>
            value ? null : "Last name is required.",
        );
        const emailInput = await ask(reader, "Email (optional, press Enter to skip): ", (value) =>
            !value || isEmail(value) ? null : "Enter a valid email address.",
        );
        const mobile = stripNonDigits(
            await ask(reader, "Mobile number (10 digits): ", (value) =>
                isMobile(value) ? null : "Enter a valid 10-digit mobile number.",
            ),
        );
        const aadhaar = stripNonDigits(
            await ask(reader, "Aadhaar number (12 digits): ", (value) =>
                isAadhaar(value) ? null : "Enter a valid 12-digit Aadhaar number.",
            ),
        );
        const password = await askHidden(rl, reader, "Password (at least 6 characters): ", (value) =>
            isStrongEnough(value) ? null : "Password must be at least 6 characters.",
        );
        await askHidden(rl, reader, "Confirm password: ", (value) =>
            value === password ? null : "Passwords do not match.",
        );

        const email = emailInput ? normalizeEmail(emailInput) : undefined;

        const connected = await connectDatabase();
        if (!connected) {
            console.error("[superadmin] could not reach the database - nothing was created.");
            process.exitCode = 1;
            return;
        }

        const existing = await User.findOne({
            $or: [{ aadhaar }, { mobile }, ...(email ? [{ email }] : [])],
        });

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

        console.log(`[superadmin] created account ${user._id} (${email ?? mobile})`);
    } finally {
        rl.close();
    }
};

create()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
        console.error("[superadmin] failed:", error);
        process.exit(1);
    });
