import mongoose from "mongoose";
import { boot, Checks, freeMobile, registerPublic, sleep } from "./harness";

/**
 * The per-account hourly cap, at its real default of 5.
 *
 * Kept apart from tests/otp.ts because that file has to spend well over five
 * codes on a single account, so it runs with OTP_MAX_PER_HOUR lifted. This one
 * must NOT override it - the number it asserts is the shipped default.
 *
 *   npx tsx tests/otp-rate-limit.ts
 */

const CAP = 5;

const run = async () => {
    const h = await boot();
    const c = new Checks();

    const pub = await registerPublic(h, "1");
    c.check("registered", pub.res.status === 201, pub.res.json?.errors);

    c.section(`hourly cap of ${CAP} per account`);
    const target = freeMobile();
    const statuses: number[] = [];
    const reasons: string[] = [];

    // One request past the cap, so we see the cap and not the cooldown.
    for (let i = 0; i <= CAP; i++) {
        const res = await h.post(
            "/api/otp/request",
            { purpose: "PROFILE_MOBILE_CHANGE", target },
            pub.token,
        );
        statuses.push(res.status);
        reasons.push(res.json?.message ?? "");
        await sleep(1100);
    }

    c.check(
        `the first ${CAP} requests are accepted`,
        statuses.slice(0, CAP).every((s) => s === 200),
        statuses,
    );
    c.check("the next request is refused 429", statuses[CAP] === 429, statuses);
    c.check(
        "the refusal says to come back later, not that the number is wrong",
        /later|wait|hour|too many|again/i.test(reasons[CAP] ?? "") &&
            !/10-digit|valid/i.test(reasons[CAP] ?? ""),
        reasons[CAP],
    );

    c.section("the cap is per account, not per server");
    const other = await registerPublic(h, "2");
    c.check("a second account registers", other.res.status === 201, other.res.json?.errors);
    const otherRes = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_MOBILE_CHANGE", target: freeMobile() },
        other.token,
    );
    c.check(
        "a different account is unaffected by the first one's exhaustion",
        otherRes.status === 200,
        otherRes.json,
    );

    c.finish();
    await h.close();
    await mongoose.disconnect();
    process.exit(c.fail > 0 ? 1 : 0);
};

run().catch((error) => {
    console.error("CRASH", error);
    process.exit(1);
});