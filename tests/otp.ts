import mongoose from "mongoose";
import { OtpChallenge } from "../src/features/otp/otp.model";
import { User } from "../src/features/users/users.model";
import {
    boot,
    Checks,
    freeEmail,
    freeMobile,
    registerNgo,
    registerPolice,
    registerPublic,
    sleep,
    unique,
} from "./harness";

/**
 * The OTP suite. Covers the module on its own and the two gates together:
 * a code proves a contact, and for police/NGO an admin still has to say yes.
 *
 * Run with the resend cooldown off so the supersede and cooldown cases do not
 * have to sleep a real minute:
 *
 *   $env:OTP_RESEND_COOLDOWN_SECONDS="1"; npx tsx tests/otp.ts
 *
 * The one-second cooldown is used rather than zero so the "wait then it works"
 * case is a real wait, not an artefact of the limit being disabled.
 *
 *   $env:OTP_RESEND_COOLDOWN_SECONDS="1"; $env:OTP_MAX_PER_HOUR="50"
 *   npx tsx tests/otp.ts
 *
 * The hourly cap is lifted here because this file deliberately spends many
 * codes on one account; tests/otp-rate-limit.ts covers the real default of 5.
 */

const SUPERADMIN = { email: "superadmin@gharwapsi.local", password: "superadmin123" };

/** Creates one admin and returns its id, for scoping the review queue in tests. */
const createAdmin = async (h: Awaited<ReturnType<typeof boot>>) => {
    const login = await h.post("/api/auth/login", {
        identifier: SUPERADMIN.email,
        password: SUPERADMIN.password,
    });
    if (login.status !== 200) {
        throw new Error(`superadmin login failed: ${JSON.stringify(login.json)}`);
    }

    const email = `site.admin.${unique()}@gharwapsi.local`;
    const created = await h.post(
        "/api/register/admin",
        {
            first_name: "Site",
            last_name: "Admin",
            email,
            aadhaar: `88${unique()}001`.slice(0, 12),
            mobile: `96${unique()}001`.slice(0, 10),
            password: "secret123",
        },
        login.json?.data?.tokens?.accessToken,
    );
    if (created.status !== 201) {
        throw new Error(`admin creation failed: ${JSON.stringify(created.json)}`);
    }

    return {
        id: created.json?.data?.user?.id as string,
        token: (await h.post("/api/auth/login", {
            identifier: created.json?.data?.user?.email,
            password: "secret123",
        })).json?.data?.tokens?.accessToken as string,
        email: created.json?.data?.user?.email as string,
    };
};

/** Forces a staff account into `admin`'s queue so the review calls are scoped. */
const assignTo = async (userId: string, adminId: string): Promise<void> => {
    await User.updateOne({ _id: userId }, { $set: { assigned_admin_id: adminId } });
};

/** An admin cannot approve until they have supplied a meeting link and time. */
const scheduleCall = async (h: Awaited<ReturnType<typeof boot>>, adminToken: string, userId: string) =>
    h.post(
        `/api/verification/requests/${userId}/call`,
        { link: "https://meet.example.com/otp", time: new Date(Date.now() + 86400000).toISOString() },
        adminToken,
    );

/** Request -> confirm, returning the receipt a profile update has to spend. */
const confirm = async (
    h: Awaited<ReturnType<typeof boot>>,
    token: string,
    purpose: "PROFILE_EMAIL_CHANGE" | "PROFILE_MOBILE_CHANGE",
    target: string,
) => {
    const requested = await h.post("/api/otp/request", { purpose, target }, token);
    const verified = await h.post(
        "/api/otp/verify",
        { challenge_id: requested.json?.data?.challenge_id, code: requested.json?.data?.dev_code },
        token,
    );
    return { requested, verified, otp_token: verified.json?.data?.otp_token as string };
};

const run = async () => {
    const h = await boot();
    const c = new Checks();

    const admin = await createAdmin(h);

    /* ================= module behaviour ================= */
    c.section("request validation");
    const pub = await registerPublic(h, "1");
    c.check("public registered", pub.res.status === 201, pub.res.json?.errors);

    const noPurpose = await h.post("/api/otp/request", { target: freeEmail("x") }, pub.token);
    c.check("missing purpose 422", noPurpose.status === 422, noPurpose.json);

    const badPurpose = await h.post(
        "/api/otp/request",
        { purpose: "LOGIN", target: freeEmail("x") },
        pub.token,
    );
    c.check("unknown purpose 422", badPurpose.status === 422, badPurpose.json);

    const mismatch = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_EMAIL_CHANGE", channel: "mobile", target: freeEmail("x") },
        pub.token,
    );
    c.check("channel that contradicts the purpose 422", mismatch.status === 422, mismatch.json);
    c.check(
        "mismatch explains the right channel",
        String(mismatch.json?.errors?.channel).includes("email"),
        mismatch.json?.errors,
    );

    const badTarget = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_EMAIL_CHANGE", target: "not-an-email" },
        pub.token,
    );
    c.check("malformed target 422", badTarget.status === 422, badTarget.json);

    const own = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_MOBILE_CHANGE", target: pub.res.json?.data?.user?.mobile },
        pub.token,
    );
    c.check("asking for the contact already on file 422", own.status === 422, own.json);

    const taken = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_MOBILE_CHANGE", target: "9999990264" },
        pub.token,
    );
    c.check("asking for a contact another account holds 422", taken.status === 422, taken.json);

    const unauth = await h.post("/api/otp/request", {
        purpose: "PROFILE_EMAIL_CHANGE",
        target: freeEmail("x"),
    });
    c.check("request without a token 401", unauth.status === 401, unauth.json);

    /* ================= cooldown ================= */
    c.section("resend cooldown");
    const coolTarget = freeMobile();
    const first = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_MOBILE_CHANGE", target: coolTarget },
        pub.token,
    );
    c.check("first request 200", first.status === 200, first.json);
    c.check("dev_code present outside production", typeof first.json?.data?.dev_code === "string");
    c.check("target is masked in the response", first.json?.data?.target_masked !== coolTarget, {
        got: first.json?.data?.target_masked,
    });

    const tooSoon = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_MOBILE_CHANGE", target: coolTarget },
        pub.token,
    );
    c.check("immediate resend 429", tooSoon.status === 429, tooSoon.json);

    await sleep(1300);
    const afterCooldown = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_MOBILE_CHANGE", target: coolTarget },
        pub.token,
    );
    c.check("resend allowed once the cooldown passes 200", afterCooldown.status === 200, afterCooldown.json);

    /* ================= a new code invalidates the old one ================= */
    c.section("new code invalidates the old one");
    const oldCode = first.json?.data?.dev_code as string;
    const oldId = first.json?.data?.challenge_id as string;
    const stale = await h.post("/api/otp/verify", { challenge_id: oldId, code: oldCode }, pub.token);
    c.check("the superseded code no longer works", stale.status === 422, stale.json);
    c.check("challenge is marked superseded", stale.json?.message?.includes("no longer valid"), stale.json?.message);

    /* ================= wrong code, attempts, reuse ================= */
    c.section("verification");
    const wrongTarget = freeEmail("w");
    const wrongReq = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_EMAIL_CHANGE", target: wrongTarget },
        pub.token,
    );
    const wrong = await h.post(
        "/api/otp/verify",
        { challenge_id: wrongReq.json?.data?.challenge_id, code: "000000" },
        pub.token,
    );
    c.check("wrong code 422", wrong.status === 422, wrong.json);
    c.check("wrong code counts down", String(wrong.json?.errors?.code).includes("left"), wrong.json?.errors);

    const rightCode = wrongReq.json?.data?.dev_code as string;
    const ok = await h.post(
        "/api/otp/verify",
        { challenge_id: wrongReq.json?.data?.challenge_id, code: rightCode },
        pub.token,
    );
    c.check("correct code 200", ok.status === 200, ok.json);
    c.check("receipt returned", typeof ok.json?.data?.otp_token === "string");
    c.check("public citizen is told no admin step is needed", ok.json?.data?.admin_approval_required === false);

    const replay = await h.post(
        "/api/otp/verify",
        { challenge_id: wrongReq.json?.data?.challenge_id, code: rightCode },
        pub.token,
    );
    c.check("the same code cannot be used twice", replay.status === 422, replay.json);

    // Max attempts, on a fresh challenge.
    c.section("max attempts");
    const bruteTarget = freeEmail("b");
    let brute = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_EMAIL_CHANGE", target: bruteTarget },
        pub.token,
    );
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
        const res = await h.post(
            "/api/otp/verify",
            { challenge_id: brute.json?.data?.challenge_id, code: "111111" },
            pub.token,
        );
        lastStatus = res.status;
        if (res.status === 429) break;
    }
    c.check("attempts run out and the code is burned 429", lastStatus === 429, lastStatus);

    // Expiry, by putting the deadline in the past the way the clock would.
    c.section("expiry");
    const expiryTarget = freeEmail("e");
    const expiring = await h.post(
        "/api/otp/request",
        { purpose: "PROFILE_EMAIL_CHANGE", target: expiryTarget },
        pub.token,
    );
    await OtpChallenge.updateOne(
        { _id: expiring.json?.data?.challenge_id },
        { $set: { expires_at: new Date(Date.now() - 1000) } },
    );
    const expired = await h.post(
        "/api/otp/verify",
        { challenge_id: expiring.json?.data?.challenge_id, code: expiring.json?.data?.dev_code },
        pub.token,
    );
    c.check("expired code 422", expired.status === 422, expired.json);
    c.check("expired code says so", String(expired.json?.message).includes("expired"), expired.json?.message);

    /* ================= public: code then immediate change ================= */
    c.section("public: OTP then change applies at once");
    const newEmail = freeEmail("pub");
    const emailFlow = await confirm(h, pub.token, "PROFILE_EMAIL_CHANGE", newEmail);
    c.check("public email OTP confirmed", emailFlow.verified.status === 200, emailFlow.verified.json);

    const applied = await h.patch(
        "/api/users/me",
        { email: newEmail, otp_token: emailFlow.otp_token },
        pub.token,
    );
    c.check("public email applied 200", applied.status === 200, applied.json);
    c.check("email actually changed", applied.json?.data?.user?.email === newEmail, applied.json?.data?.user?.email);
    c.check("public stays verified", applied.json?.data?.user?.verification_status === "verified");

    const spent = await h.patch("/api/users/me", { email: freeEmail("again"), otp_token: emailFlow.otp_token }, pub.token);
    c.check("the receipt cannot be spent twice", spent.status === 422, spent.json);

    const newMobile = freeMobile();
    const mobileFlow = await confirm(h, pub.token, "PROFILE_MOBILE_CHANGE", newMobile);
    const mobileApplied = await h.patch(
        "/api/users/me",
        { mobile: newMobile, otp_token: mobileFlow.otp_token },
        pub.token,
    );
    c.check("public mobile applied 200", mobileApplied.status === 200, mobileApplied.json);
    c.check("mobile actually changed", mobileApplied.json?.data?.user?.mobile === newMobile);

    // A receipt for the email change must not pay for a mobile change.
    const otherPurpose = await confirm(h, pub.token, "PROFILE_EMAIL_CHANGE", freeEmail("pp"));
    const wrongUse = await h.patch(
        "/api/users/me",
        { mobile: freeMobile(), otp_token: otherPurpose.otp_token },
        pub.token,
    );
    c.check("a receipt cannot be reused for another purpose", wrongUse.status === 422, wrongUse.json);

    // A genuine receipt for one address must not pay for a different address.
    const mismatchTarget = freeEmail("m");
    const mismatchFlow = await confirm(h, pub.token, "PROFILE_EMAIL_CHANGE", mismatchTarget);
    const otherAddress = await h.patch(
        "/api/users/me",
        { email: freeEmail("m2"), otp_token: mismatchFlow.otp_token },
        pub.token,
    );
    c.check("a receipt is void for a different address", otherAddress.status === 422, otherAddress.json);

    /* ================= police: code then admin approval ================= */
    c.section("police: OTP success is not approval");
    const pol = await registerPolice(h, "2");
    c.check("police registered", pol.res.status === 201, pol.res.json?.errors);
    const polId = pol.res.json?.data?.user?.id as string;
    await assignTo(polId, admin.id);

    const polOldEmail = pol.res.json?.data?.user?.email as string;
    const polNewEmail = freeEmail("pol");

    const polNoCode = await h.patch("/api/users/me/police", { email: polNewEmail }, pol.token);
    c.check("police email without a code 422", polNoCode.status === 422, polNoCode.json);

    const polBadCode = await h.patch(
        "/api/users/me/police",
        { email: polNewEmail, otp_token: "made-up" },
        pol.token,
    );
    c.check("police email with a made-up receipt 422", polBadCode.status === 422, polBadCode.json);

    const polFlow = await confirm(h, pol.token, "PROFILE_EMAIL_CHANGE", polNewEmail);
    c.check("police email OTP confirmed", polFlow.verified.status === 200, polFlow.verified.json);
    c.check(
        "police is told an admin is still required",
        polFlow.verified.json?.data?.admin_approval_required === true,
        polFlow.verified.json?.data,
    );

    const polStaged = await h.patch(
        "/api/users/me/police",
        { email: polNewEmail, otp_token: polFlow.otp_token },
        pol.token,
    );
    c.check("police email staged 200", polStaged.status === 200, polStaged.json);
    c.check(
        "live email is UNCHANGED until an admin approves",
        polStaged.json?.data?.user?.email === polOldEmail,
        polStaged.json?.data?.user?.email,
    );
    c.check(
        "the new address is held as pending_contact",
        polStaged.json?.data?.pending_contact?.email === polNewEmail,
        polStaged.json?.data?.pending_contact,
    );
    c.check("and the account is back to pending", polStaged.json?.data?.user?.verification_status === "pending");
    c.check("not verified despite a good code", polStaged.json?.data?.user?.verification_status !== "verified");

    const adminSeesIt = await h.get(`/api/verification/requests/${polId}`, admin.token);
    c.check("admin can read the proposed contact", adminSeesIt.json?.data?.pending_contact?.email === polNewEmail, adminSeesIt.json?.data?.pending_contact);

    const approveEarly = await h.post(`/api/verification/requests/${polId}/approve`, {}, admin.token);
    c.check("approve without a meeting link is refused", approveEarly.status === 422, approveEarly.json);

    c.check("call scheduled", (await scheduleCall(h, admin.token, polId)).status === 200);
    const approved = await h.post(`/api/verification/requests/${polId}/approve`, {}, admin.token);
    c.check("approve 200", approved.status === 200, approved.json);
    c.check(
        "approval applies the new email",
        approved.json?.data?.email === polNewEmail,
        approved.json?.data?.email,
    );
    c.check("account is verified", approved.json?.data?.status === "verified", approved.json?.data?.status);
    c.check("pending_contact is cleared", approved.json?.data?.pending_contact === null);

    /* ================= police mobile + rejection ================= */
    c.section("police: rejected request changes nothing");
    const pol2 = await registerPolice(h, "4");
    const pol2Id = pol2.res.json?.data?.user?.id as string;
    const pol2OldEmail = pol2.res.json?.data?.user?.email as string;
    await assignTo(pol2Id, admin.id);

    const pol2NewMobile = freeMobile();
    const pol2Flow = await confirm(h, pol2.token, "PROFILE_MOBILE_CHANGE", pol2NewMobile);
    const pol2Staged = await h.patch(
        "/api/users/me/police",
        { mobile: pol2NewMobile, otp_token: pol2Flow.otp_token },
        pol2.token,
    );
    c.check("police mobile staged 200", pol2Staged.status === 200, pol2Staged.json);
    c.check(
        "live mobile unchanged while waiting",
        pol2Staged.json?.data?.user?.mobile !== pol2NewMobile,
        pol2Staged.json?.data?.user?.mobile,
    );
    c.check(
        "new mobile held as pending_contact",
        pol2Staged.json?.data?.pending_contact?.mobile === pol2NewMobile,
        pol2Staged.json?.data?.pending_contact,
    );

    const rejected = await h.post(
        `/api/verification/requests/${pol2Id}/reject`,
        { reason: "The number on file does not match our records." },
        admin.token,
    );
    c.check("reject 200", rejected.status === 200, rejected.json);
    c.check("status is rejected", rejected.json?.data?.status === "rejected", rejected.json?.data?.status);

    const pol2After = await h.get("/api/users/me", pol2.token);
    c.check("email untouched by the rejection", pol2After.json?.data?.user?.email === pol2OldEmail, pol2After.json?.data?.user?.email);
    c.check(
        "mobile untouched by the rejection",
        pol2After.json?.data?.user?.mobile !== pol2NewMobile,
        pol2After.json?.data?.user?.mobile,
    );
    c.check("pending_contact discarded", pol2After.json?.data?.pending_contact === null, pol2After.json?.data?.pending_contact);

    /* ================= NGO ================= */
    c.section("ngo: OTP plus approval");
    const ngo = await registerNgo(h, "3");
    c.check("ngo registered", ngo.res.status === 201, ngo.res.json?.errors);
    const ngoId = ngo.res.json?.data?.user?.id as string;
    await assignTo(ngoId, admin.id);
    const ngoOldEmail = ngo.res.json?.data?.user?.email as string;

    const ngoNoCode = await h.patch("/api/users/me/ngo", { email: freeEmail("ngo") }, ngo.token);
    c.check("ngo email without a code 422", ngoNoCode.status === 422, ngoNoCode.json);

    const ngoNewMobile = freeMobile();
    const ngoNoCodeMobile = await h.patch("/api/users/me/ngo", { mobile: ngoNewMobile }, ngo.token);
    c.check("ngo mobile without a code 422", ngoNoCodeMobile.status === 422, ngoNoCodeMobile.json);

    const ngoNewEmail = freeEmail("ngo2");
    const ngoFlow = await confirm(h, ngo.token, "PROFILE_EMAIL_CHANGE", ngoNewEmail);
    c.check(
        "ngo is told an admin is still required",
        ngoFlow.verified.json?.data?.admin_approval_required === true,
        ngoFlow.verified.json?.data,
    );
    const ngoStaged = await h.patch(
        "/api/users/me/ngo",
        { email: ngoNewEmail, otp_token: ngoFlow.otp_token },
        ngo.token,
    );
    c.check("ngo email staged 200", ngoStaged.status === 200, ngoStaged.json);
    c.check(
        "live email unchanged for ngo too",
        ngoStaged.json?.data?.user?.email === ngoOldEmail,
        ngoStaged.json?.data?.user?.email,
    );
    c.check("ngo back to pending", ngoStaged.json?.data?.user?.verification_status === "pending");

    c.check("call scheduled for ngo", (await scheduleCall(h, admin.token, ngoId)).status === 200);
    const ngoApproved = await h.post(`/api/verification/requests/${ngoId}/approve`, {}, admin.token);
    c.check("ngo approve 200", ngoApproved.status === 200, ngoApproved.json);
    c.check("ngo email applied on approval", ngoApproved.json?.data?.email === ngoNewEmail, ngoApproved.json?.data?.email);

    /* ================= staff name change: no code, but still reviewed ============ */
    c.section("staff: a name needs no code, but the admin still sees it");
    const ngoName = await h.patch("/api/users/me/ngo", { first_name: "Renamed" }, ngo.token);
    c.check("ngo name change 200 without a code", ngoName.status === 200, ngoName.json);
    c.check("name actually changed", ngoName.json?.data?.user?.first_name === "Renamed");
    c.check(
        "and the account goes back to pending for review",
        ngoName.json?.data?.user?.verification_status === "pending",
        ngoName.json?.data?.user?.verification_status,
    );
    c.check(
        "the response tells the member an admin has to look at it",
        /admin/i.test(ngoName.json?.message ?? ""),
        ngoName.json?.message,
    );

    /* ================= cross-role walls ================= */
    c.section("cross-role");
    const ngoOnPolice = await h.patch(
        "/api/users/me/police",
        { email: freeEmail("x"), otp_token: "t" },
        ngo.token,
    );
    c.check("ngo cannot use the police endpoint 403", ngoOnPolice.status === 403, ngoOnPolice.json);

    const polOnCitizen = await h.patch("/api/users/me", { first_name: "X" }, pol.token);
    c.check("police cannot use the citizen endpoint 403", polOnCitizen.status === 403, polOnCitizen.json);

    /* ================= rate limit lives in otp-rate-limit.ts ================= */

    c.finish();
    await h.close();
    await mongoose.disconnect();
    process.exit(c.fail > 0 ? 1 : 0);
};

run().catch(async (error) => {
    console.error("CRASH", error);
    process.exit(1);
});