import mongoose from "mongoose";
import { boot, Checks, freeEmail, registerPublic } from "./harness";

/**
 * The two races that a read-then-write implementation loses.
 *
 * Both of these pass by accident if the two requests happen to be a few
 * milliseconds apart, because the first one will already have finished writing.
 * So each case fires every request at the *same* time with Promise.all, which
 * puts them in flight together and lets them interleave.
 *
 *   $env:OTP_RESEND_COOLDOWN_SECONDS="1"; npx tsx tests/otp-concurrency.ts
 */

const run = async () => {
    const h = await boot();
    const c = new Checks();

    const pub = await registerPublic(h, "1");
    c.check("registered", pub.res.status === 201, pub.res.json?.errors);

    /* ================= two requests, one correct code ================= */
    c.section("the same code confirmed twice at the same moment");
    const emailTarget = freeEmail("race");
    const requested = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_EMAIL_CHANGE", target: emailTarget },
        pub.token,
    );
    c.check("challenge issued", requested.status === 200, requested.json);
    const { challenge_id, dev_code } = requested.json.data;

    const concurrent = await Promise.all(
        Array.from({ length: 5 }, () =>
            h.post("/api/otp/verify", { challenge_id, code: dev_code }, pub.token),
        ),
    );
    const winners = concurrent.filter((r) => r.status === 200);
    const receipts = winners.map((r) => r.json?.data?.otp_token).filter(Boolean);

    c.check(
        "exactly one of five concurrent confirmations succeeds",
        winners.length === 1,
        concurrent.map((r) => r.status),
    );
    c.check(
        "the losers are told the code is spent",
        concurrent.filter((r) => r.status !== 200).every((r) => r.status === 422),
        concurrent.map((r) => r.json?.message),
    );
    c.check("only one receipt exists", new Set(receipts).size === winners.length, receipts);

    /* ================= one receipt, spent twice at the same moment ======== */
    c.section("the same receipt spent twice at the same moment");
    const receipt = receipts[0] as string;
    // The same address the code was sent to - a different one is refused earlier,
    // for a different reason, and that case is covered in tests/otp.ts.
    const spendTarget = emailTarget;

    const spends = await Promise.all(
        Array.from({ length: 5 }, () =>
            h.patch("/api/users/me", { email: spendTarget, otp_token: receipt }, pub.token),
        ),
    );
    const applied = spends.filter((r) => r.status === 200);

    c.check(
        "exactly one of five concurrent spends succeeds",
        applied.length === 1,
        spends.map((r) => `${r.status} ${r.json?.message ?? ""} ${JSON.stringify(r.json?.errors ?? {})}`),
    );
    c.check(
        "the losers are told the code is used up",
        spends
            .filter((r) => r.status !== 200)
            .every((r) => r.status === 422 && /used for a change|not valid/i.test(r.json?.message ?? "")),
        spends.map((r) => r.json?.message),
    );

    const me = await h.get("/api/users/me", pub.token);
    c.check("the email really did change, once", me.json?.data?.user?.email === spendTarget, {
        got: me.json?.data?.user?.email,
        wanted: spendTarget,
        meStatus: me.status,
        meBody: me.json,
    });

    /* ================= attempts cap under concurrent guessing ============== */
    c.section("more guesses than allowed, all at once");
    const bruteTarget = freeEmail("brute");
    const brute = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_EMAIL_CHANGE", target: bruteTarget },
        pub.token,
    );
    c.check("challenge issued", brute.status === 200, brute.json);

    // Ten simultaneous wrong guesses against a five-attempt code.
    const guesses = await Promise.all(
        Array.from({ length: 10 }, () =>
            h.post(
                "/api/otp/verify",
                { challenge_id: brute.json?.data?.challenge_id, code: "000000" },
                pub.token,
            ),
        ),
    );

    c.check(
        "no more than the allowed number of guesses are counted",
        guesses.filter((r) => r.status === 422 && /attempt/i.test(r.json?.message ?? "")).length <= 4,
        guesses.map((r) => r.status),
    );
    c.check(
        "the rest are refused for running out of tries",
        guesses.some((r) => r.status === 429),
        guesses.map((r) => r.status),
    );

    // And the code is genuinely dead afterwards, even with the right one.
    const real = brute.json?.data?.dev_code as string;
    const afterBrute = await h.post(
        "/api/otp/verify",
        { challenge_id: brute.json?.data?.challenge_id, code: real },
        pub.token,
    );
    c.check(
        "the correct code is refused once the attempts ran out",
        afterBrute.status === 429 || afterBrute.status === 422,
        afterBrute.json,
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