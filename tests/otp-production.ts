import mongoose from "mongoose";
import { boot, Checks, freeEmail, freeMobile, registerPublic } from "./harness";

/**
 * The dummy providers must be inert in production: no code in the log, no code
 * in the response, and a clean 503 rather than a challenge nobody can complete.
 *
 * This has to run in a production-mode process, because `env.isProduction` is
 * read once at startup. The first check fails the run loudly if the runner
 * forgot, so a green result cannot come from testing development behaviour.
 *
 *   $env:NODE_ENV="production"; npx tsx tests/otp-production.ts
 */

const isProductionRun = process.env.NODE_ENV === "production";

/** Captures anything written to the console while `fn` runs. */
const captureConsole = async <T>(fn: () => Promise<T>): Promise<{ result: T; log: string }> => {
    const lines: string[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    const record = (...args: unknown[]) => lines.push(args.map(String).join(" "));

    console.log = record;
    console.warn = record;
    console.error = record;
    try {
        return { result: await fn(), log: lines.join("\n") };
    } finally {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
    }
};

const run = async () => {
    const c = new Checks();

    c.section("this file only means anything in production mode");
    c.check(
        "NODE_ENV is production",
        isProductionRun,
        process.env.NODE_ENV ?? "(unset)",
    );
    if (!isProductionRun) {
        c.finish();
        process.exit(1);
        return;
    }

    const h = await boot();

    const pub = await registerPublic(h, "1");
    c.check("registered", pub.res.status === 201, pub.res.json?.errors);

    /* ================= the code must never be logged ================= */
    c.section("no code in the log");
    const emailAttempt = await captureConsole(() =>
        h.post("/api/otp/request", { purpose: "PROFILE_EMAIL_CHANGE", target: freeEmail("p") }, pub.token),
    );
    const smsAttempt = await captureConsole(() =>
        h.post("/api/otp/request", { purpose: "PROFILE_MOBILE_CHANGE", target: freeMobile() }, pub.token),
    );

    for (const [label, attempt] of [["email", emailAttempt], ["sms", smsAttempt]] as const) {
        c.check(`${label}: the request is refused 503`, attempt.result.status === 503, {
            got: attempt.result.status,
            body: attempt.result.json,
        });
        // A real six digit code anywhere in the captured output would be the bug.
        const codes = attempt.log.match(/\b\d{6}\b/g) ?? [];
        c.check(`${label}: no six digit code in the log`, codes.length === 0, { codes, log: attempt.log });
        c.check(
            `${label}: nothing says DEV-ONLY`,
            !/DEV-ONLY/i.test(attempt.log),
            attempt.log,
        );
    }

    /* ================= no code in the response ================= */
    c.section("no code in the response");
    const wholeBody = JSON.stringify([emailAttempt.result.json, smsAttempt.result.json]);
    c.check("no dev_code field at all", !/"dev_code"/.test(wholeBody), wholeBody);
    c.check(
        "no six digit code anywhere in the body",
        (wholeBody.match(/\b\d{6}\b/g) ?? []).length === 0,
        wholeBody,
    );

    /* ================= nothing left behind ================= */
    c.section("no live challenge left behind");
    const { OtpChallenge } = await import("../src/features/otp/otp.model");
    const live = await OtpChallenge.countDocuments({ user_id: pub.res.json.data.user.id, status: "pending" });
    c.check("no pending challenge survives the failure", live === 0, { live });

    // And a refused attempt does not eat the hourly allowance for a working one.
    const failedRows = await OtpChallenge.countDocuments({
        user_id: pub.res.json.data.user.id,
        status: { $in: ["pending", "superseded"] },
    });
    c.check("nothing usable was stored", failedRows === 0, { failedRows });

    c.finish();
    await h.close();
    await mongoose.disconnect();
    process.exit(c.fail > 0 ? 1 : 0);
};

run().catch((error) => {
    console.error("CRASH", error);
    process.exit(1);
});