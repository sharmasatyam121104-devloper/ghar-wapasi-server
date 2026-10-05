import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Runs every check script and adds up the results.
 *
 * There is no test runner in this project, and the suites disagree about the
 * environment on purpose: the rate-limit suite asserts the shipped default of 5
 * codes an hour, so it must not have the limit overridden, while the main OTP
 * suite spends far more than five codes on one account and has to be given
 * room. The production suite has to start in production mode. So the settings
 * live here, per file, rather than in one place nobody can vary.
 *
 *   npm test
 *
 * Each script talks to the real database, so run them one at a time - which this
 * does - and expect them to add users.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** tsx's own entry point, run with this node. Avoids `npx`, which does not spawn on Windows. */
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

const SUITES = [
    {
        file: "tests/profile-update.regression.ts",
        env: {},
        why: "the three profile endpoints, and that the OTP gate did not change the rest",
    },
    {
        file: "tests/otp.ts",
        env: { OTP_RESEND_COOLDOWN_SECONDS: "1", OTP_MAX_PER_HOUR: "50" },
        why: "the OTP module, and the public/police/NGO flows end to end",
    },
    {
        file: "tests/staff-name-review.ts",
        env: { OTP_RESEND_COOLDOWN_SECONDS: "1", OTP_MAX_PER_HOUR: "50" },
        why: "a police or NGO name goes back for review, and a citizen's does not",
    },
    {
        file: "tests/otp-concurrency.ts",
        env: { OTP_RESEND_COOLDOWN_SECONDS: "1", OTP_MAX_PER_HOUR: "50" },
        why: "one code and one receipt cannot be spent twice at the same moment",
    },
    {
        file: "tests/otp-rate-limit.ts",
        env: { OTP_RESEND_COOLDOWN_SECONDS: "1" },
        why: "the shipped hourly cap of 5, so the limit is deliberately NOT raised here",
    },
    {
        file: "tests/otp-production.ts",
        env: { NODE_ENV: "production" },
        why: "no code in the log, in the response, or left behind in production",
    },
];

/** Pulls "=== 42 passed, 0 failed ===" out of a suite's output. */
const tally = (output) => {
    const match = output.match(/===\s*(\d+) passed,\s*(\d+) failed\s*===/);
    if (!match) return null;
    return { pass: Number(match[1]), fail: Number(match[2]) };
};

const runSuite = (suite) =>
    new Promise((resolve) => {
        const child = spawn(process.execPath, [tsxCli, suite.file], {
            cwd: root,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, ...suite.env },
        });

        let output = "";
        const collect = (chunk) => {
            output += chunk;
        };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);

        child.on("close", (code) => {
            // Suites print their own per-check lines; only failures are worth
            // repeating here, and only when something actually failed.
            if (code !== 0) {
                console.log(output);
            }
            const counts = tally(output) ?? { pass: 0, fail: 1 };
            resolve({ ...suite, code, ...counts });
        });
    });

const main = async () => {
    const results = [];
    for (const suite of SUITES) {
        console.log(`\n> ${suite.file}`);
        console.log(`  ${suite.why}`);
        results.push(await runSuite(suite));
    }

    console.log("\n--------------------------------------------------");
    let pass = 0;
    let fail = 0;
    for (const r of results) {
        pass += r.pass;
        fail += r.fail;
        const mark = r.code === 0 && r.fail === 0 ? "ok  " : "FAIL";
        console.log(`${mark} ${r.file}  ${r.pass} passed, ${r.fail} failed`);
    }
    console.log("--------------------------------------------------");
    console.log(`${pass} checks passed, ${fail} failed across ${results.length} suites`);

    process.exit(fail === 0 && results.every((r) => r.code === 0) ? 0 : 1);
};

main();