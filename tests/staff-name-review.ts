import mongoose from "mongoose";
import { OtpChallenge } from "../src/features/otp/otp.model";
import { User } from "../src/features/users/users.model";
import {
    boot,
    Checks,
    registerNgo,
    registerPolice,
    registerPublic,
    sleep,
    unique,
} from "./harness";

/**
 * A police or NGO member's name goes back for admin review, exactly like a
 * profile field does. No code is involved - the point is that a name is part of
 * what an admin vets, so it cannot quietly land on a verified account.
 *
 * The contrast is the other half of the contract: a citizen's name change is
 * untouched by any of this and still applies immediately.
 *
 *   $env:OTP_RESEND_COOLDOWN_SECONDS="1"; $env:OTP_MAX_PER_HOUR="50"
 *   npx tsx tests/staff-name-review.ts
 */

const SUPERADMIN = { email: "superadmin@gharwapsi.local", password: "superadmin123" };

/** A fresh admin, so the review queue assertions are scoped to our own users. */
const createAdmin = async (h: Awaited<ReturnType<typeof boot>>) => {
    const login = await h.post("/api/auth/login", {
        identifier: SUPERADMIN.email,
        password: SUPERADMIN.password,
    });
    if (login.status !== 200) throw new Error(`superadmin login failed: ${JSON.stringify(login.json)}`);

    const email = `name.admin.${unique()}@gharwapsi.local`;
    const created = await h.post(
        "/api/register/admin",
        {
            first_name: "Name",
            last_name: "Admin",
            email,
            aadhaar: `87${unique()}001`.slice(0, 12),
            mobile: `94${unique()}001`.slice(0, 10),
            password: "secret123",
        },
        login.json?.data?.tokens?.accessToken,
    );
    if (created.status !== 201) throw new Error(`admin creation failed: ${JSON.stringify(created.json)}`);

    return {
        id: created.json?.data?.user?.id as string,
        token: (await h.post("/api/auth/login", {
            identifier: created.json?.data?.user?.email,
            password: "secret123",
        })).json?.data?.tokens?.accessToken as string,
    };
};

const scheduleCall = async (h: Awaited<ReturnType<typeof boot>>, adminToken: string, userId: string) =>
    h.post(
        `/api/verification/requests/${userId}/call`,
        { link: "https://meet.example.com/name", time: new Date(Date.now() + 86400000).toISOString() },
        adminToken,
    );

const run = async () => {
    const h = await boot();
    const c = new Checks();
    const admin = await createAdmin(h);

    /* ================= police ================= */
    c.section("police: a name re-queues the account");
    const pol = await registerPolice(h, "1");
    c.check("police registered", pol.res.status === 201, pol.res.json?.errors);
    const polId = pol.res.json?.data?.user?.id as string;
    const polOldName = pol.res.json?.data?.user?.first_name as string;
    await User.updateOne({ _id: polId }, { $set: { assigned_admin_id: admin.id } });

    // Approved up front, so the name change is tested from `verified` - the state
    // where a change slipping through would actually matter.
    c.check("call scheduled", (await scheduleCall(h, admin.token, polId)).status === 200);
    const approved = await h.post(`/api/verification/requests/${polId}/approve`, {}, admin.token);
    c.check("police starts verified", approved.json?.data?.status === "verified", approved.json?.data?.status);

    const rename = await h.patch(
        "/api/users/me/police",
        { first_name: "Corrected", last_name: "Name" },
        pol.token,
    );
    c.check("police name change 200", rename.status === 200, rename.json);
    c.check(
        "no code was demanded or needed",
        rename.status === 200 && !/otp|code|confirm/i.test(rename.json?.message ?? ""),
        rename.json?.message,
    );
    c.check("the new name is applied", rename.json?.data?.user?.first_name === "Corrected", rename.json?.data?.user);
    c.check("last_name too", rename.json?.data?.user?.last_name === "Name");
    c.check(
        "and the account is back to pending",
        rename.json?.data?.user?.verification_status === "pending",
        rename.json?.data?.user?.verification_status,
    );
    c.check("no longer verified", rename.json?.data?.user?.verification_status !== "verified");
    c.check(
        "the member is told an admin has to review it",
        /admin/i.test(rename.json?.message ?? ""),
        rename.json?.message,
    );
    c.check(
        "and no contact is pending - only names are involved",
        rename.json?.data?.pending_contact === null,
        rename.json?.data?.pending_contact,
    );

    const queued = await h.get(`/api/verification/requests/${polId}`, admin.token);
    c.check(
        "the admin sees the corrected name in the queue",
        queued.json?.data?.profile?.first_name === "Corrected" || queued.json?.data?.first_name === "Corrected",
        queued.json?.data,
    );

    c.check("call scheduled again", (await scheduleCall(h, admin.token, polId)).status === 200);
    const reApproved = await h.post(`/api/verification/requests/${polId}/approve`, {}, admin.token);
    c.check("approve 200", reApproved.status === 200, reApproved.json);
    c.check("verified again", reApproved.json?.data?.status === "verified", reApproved.json?.data?.status);
    c.check(
        "the approved name survived",
        reApproved.json?.data?.first_name === "Corrected",
        reApproved.json?.data?.first_name,
    );

    /* ================= a rejected name change ================= */
    c.section("police: a rejected name change leaves the name but the status rejected");
    const rejected = await h.post(
        `/api/verification/requests/${polId}/reject`,
        { reason: "Name does not match the record." },
        admin.token,
    );
    c.check("reject 200", rejected.status === 200, rejected.json);
    c.check("status is rejected", rejected.json?.data?.status === "rejected", rejected.json?.data?.status);
    c.check(
        "the name is NOT rolled back - it was already applied, like a profile field",
        rejected.json?.data?.first_name === "Corrected",
        rejected.json?.data?.first_name,
    );

    // Rejected accounts may always fix and resubmit, window or not.
    const afterReject = await h.patch("/api/users/me/police", { last_name: "Resubmitted" }, pol.token);
    c.check("a rejected account can change its name again", afterReject.status === 200, afterReject.json);
    c.check("and lands back in pending", afterReject.json?.data?.user?.verification_status === "pending");

    /* ================= NGO ================= */
    c.section("ngo: same rule");
    const ngo = await registerNgo(h, "2");
    c.check("ngo registered", ngo.res.status === 201, ngo.res.json?.errors);
    const ngoId = ngo.res.json?.data?.user?.id as string;
    await User.updateOne({ _id: ngoId }, { $set: { assigned_admin_id: admin.id } });

    const ngoRename = await h.patch("/api/users/me/ngo", { first_name: "Ng corrected" }, ngo.token);
    c.check("ngo name change 200", ngoRename.status === 200, ngoRename.json);
    c.check("name applied", ngoRename.json?.data?.user?.first_name === "Ng corrected");
    c.check(
        "account re-queued",
        ngoRename.json?.data?.user?.verification_status === "pending",
        ngoRename.json?.data?.user?.verification_status,
    );

    /* ================= a blank name is still rejected ================= */
    c.section("a name has to be a name");
    const blank = await h.patch("/api/users/me/ngo", { first_name: "   " }, ngo.token);
    c.check("blank first_name 422", blank.status === 422, blank.json);
    c.check("reported by name", typeof blank.json?.errors?.first_name === "string", blank.json?.errors);

    const afterBlank = await h.get("/api/users/me", ngo.token);
    c.check("the old name survived the refusal", afterBlank.json?.data?.user?.first_name === "Ng corrected", afterBlank.json?.data?.user?.first_name);
    c.check(
        "and a refused request does not re-queue anything",
        afterBlank.json?.data?.user?.verification_status === "pending",
        afterBlank.json?.data?.user?.verification_status,
    );

    /* ================= the 6 hour window covers names ================= */
    c.section("the 6 hour window covers a name, not just a profile field");
    const late = await registerPolice(h, "3");
    const lateId = late.res.json?.data?.user?.id as string;
    await User.updateOne({ _id: lateId }, { $set: { assigned_admin_id: admin.id } });
    c.check("call scheduled", (await scheduleCall(h, admin.token, lateId)).status === 200);
    await h.post(`/api/verification/requests/${lateId}/approve`, {}, admin.token);

    // Verified, but submitted long enough ago that the window has closed.
    await User.updateOne({ _id: lateId }, { $set: { submitted_at: new Date(Date.now() - 7 * 3600 * 1000) } });

    const lateName = await h.patch("/api/users/me/police", { first_name: "TooLate" }, late.token);
    c.check("a name change outside the window 403", lateName.status === 403, lateName.json);
    c.check(
        "and it says the window is what closed",
        /window/i.test(lateName.json?.message ?? ""),
        lateName.json?.message,
    );

    const stillVerified = await User.findById(lateId).lean();
    c.check(
        "the name did not change",
        stillVerified?.first_name !== "TooLate",
        stillVerified?.first_name,
    );
    c.check(
        "and the account is untouched",
        stillVerified?.verification_status === "verified",
        stillVerified?.verification_status,
    );

    // A profile field is refused the same way, so neither route round the window.
    const lateProfile = await h.patch("/api/users/me/police", { police: { district: "Kanpur" } }, late.token);
    c.check("a profile change outside the window is refused too", lateProfile.status === 403, lateProfile.json);

    /* ================= a citizen is unaffected ================= */
    c.section("a citizen's name still goes straight in");
    const pub = await registerPublic(h, "4");
    c.check("citizen registered", pub.res.status === 201, pub.res.json?.errors);
    const pubId = pub.res.json?.data?.user?.id as string;

    const pubRename = await h.patch("/api/users/me", { first_name: "Citizen Renamed" }, pub.token);
    c.check("citizen name change 200", pubRename.status === 200, pubRename.json);
    c.check("applied", pubRename.json?.data?.user?.first_name === "Citizen Renamed");
    c.check(
        "and stays verified - no review, no queue",
        pubRename.json?.data?.user?.verification_status === "verified",
        pubRename.json?.data?.user?.verification_status,
    );

    const pubRow = await User.findById(pubId).lean();
    c.check(
        "nothing was requeued behind the scenes either",
        pubRow?.verification_status === "verified" && !pubRow?.assigned_admin_id,
        { status: pubRow?.verification_status, admin: pubRow?.assigned_admin_id },
    );
    c.check(
        "and a citizen change needs no admin call",
        !/admin/i.test(pubRename.json?.message ?? ""),
        pubRename.json?.message,
    );

    /* ================= nothing here needs a code ================= */
    c.section("not one code was involved");
    const codesFor = async (userId: string) =>
        OtpChallenge.countDocuments({ user_id: userId });

    c.check("no challenge for the police account", (await codesFor(polId)) === 0);
    c.check("no challenge for the NGO account", (await codesFor(ngoId)) === 0);
    c.check("no challenge for the citizen", (await codesFor(pubId)) === 0);

    c.finish();
    await h.close();
    await mongoose.disconnect();
    process.exit(c.fail > 0 ? 1 : 0);
};

run().catch((error) => {
    console.error("CRASH", error);
    process.exit(1);
});