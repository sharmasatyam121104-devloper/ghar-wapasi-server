import { boot, Checks, registerNgo, registerPolice, registerPublic } from "./harness";

/**
 * The role-wise profile update suite, unchanged in intent from the 42 checks that
 * ran before the OTP work. Kept as a file so it can be re-run against any later
 * change to those three endpoints.
 *
 * Only one expectation here is deliberately different from before: a public
 * citizen changing their email or mobile now needs a code, so those two cases
 * assert the new refusal. Everything else - the role walls, the locked fields,
 * the partial merge - must not have moved.
 */

const run = async () => {
    const h = await boot();
    const c = new Checks();

    // One digit each: the harness builds Aadhaar and mobile numbers out of it.
    const pub = await registerPublic(h, "1");
    const pol = await registerPolice(h, "2");
    const ngo = await registerNgo(h, "3");
    c.check("all three roles registered", [pub, pol, ngo].every((r) => r.res.status === 201), {
        public: pub.res.status,
        police: pol.res.status,
        ngo: ngo.res.status,
        publicBody: pub.res.json?.errors,
    });

    /* ---------------- public: no approval, but a code for contact --------------- */
    c.section("public -> PATCH /api/users/me");
    const nameOnly = await h.patch("/api/users/me", { first_name: "Renamed" }, pub.token);
    c.check("public name update 200 (no OTP)", nameOnly.status === 200, nameOnly.json);
    c.check("first_name saved", nameOnly.json?.data?.user?.first_name === "Renamed");
    c.check("stays verified", nameOnly.json?.data?.user?.verification_status === "verified");

    const withEmail = await h.patch("/api/users/me", { email: `new.${Date.now()}@example.com` }, pub.token);
    c.check("public email without a code is refused", withEmail.status === 422, withEmail.json);
    c.check(
        "refusal asks for a confirmation",
        String(withEmail.json?.errors?.otp_token ?? "").length > 0,
        withEmail.json?.errors,
    );

    const withMobile = await h.patch("/api/users/me", { mobile: `96${Date.now().toString().slice(-8)}` }, pub.token);
    c.check("public mobile without a code is refused", withMobile.status === 422, withMobile.json);

    const fakeToken = await h.patch(
        "/api/users/me",
        { email: `fake.${Date.now()}@example.com`, otp_token: "not-a-real-receipt" },
        pub.token,
    );
    c.check("a made-up otp_token is refused", fakeToken.status === 422, fakeToken.json);

    const withPolice = await h.patch("/api/users/me", { police: { district: "X" } }, pub.token);
    c.check("public cannot send a police block", withPolice.status === 422, withPolice.json);
    const withNgo = await h.patch("/api/users/me", { ngo: { city: "X" } }, pub.token);
    c.check("public cannot send an ngo block", withNgo.status === 422, withNgo.json);

    const verifiedFlag = await h.patch(
        "/api/users/me",
        { email: `x.${Date.now()}@example.com`, verified: true, otp_verified: true },
        pub.token,
    );
    c.check("a client-sent verified flag achieves nothing", verifiedFlag.status === 422, verifiedFlag.json);

    /* ---------------- police: approval required -------------------------------- */
    c.section("police -> PATCH /api/users/me/police");
    const district = await h.patch("/api/users/me/police", { police: { district: "Barabanki" } }, pol.token);
    c.check("police update 200", district.status === 200, district.json);
    c.check("district saved", district.json?.data?.police?.district === "Barabanki");
    c.check("goes back to pending", district.json?.data?.user?.verification_status === "pending");
    c.check("message mentions admin review", String(district.json?.message).includes("admin has to review"));

    const polOnPublic = await h.patch("/api/users/me", { first_name: "X" }, pol.token);
    c.check("police blocked from citizen endpoint 403", polOnPublic.status === 403, polOnPublic.json);
    c.check("403 names the police endpoint", String(polOnPublic.json?.message).includes("/api/users/me/police"));
    const polOnNgo = await h.patch("/api/users/me/ngo", { ngo: { city: "X" } }, pol.token);
    c.check("police blocked from ngo endpoint 403", polOnNgo.status === 403, polOnNgo.json);

    for (const field of ["rank", "badge_number", "station_name", "employee_id", "id_card_files", "official_email"]) {
        const res = await h.patch("/api/users/me/police", { police: { [field]: "HACKED" } }, pol.token);
        c.check(`locked police field (${field}) 422`, res.status === 422, res.json?.errors);
    }

    const mixed = await h.patch(
        "/api/users/me/police",
        { police: { district: "Unnao", rank: "Inspector" } },
        pol.token,
    );
    c.check("mixed body rejected 422", mixed.status === 422, mixed.json);
    const afterMixed = await h.patch("/api/users/me/police", {}, pol.token);
    c.check("rejected body changed nothing (district)", afterMixed.json?.data?.police?.district === "Barabanki");
    c.check("rejected body changed nothing (rank)", afterMixed.json?.data?.police?.rank === "Constable");

    /* ---------------- ngo: approval required ----------------------------------- */
    c.section("ngo -> PATCH /api/users/me/ngo");
    const city = await h.patch("/api/users/me/ngo", { ngo: { city: "Kanpur" } }, ngo.token);
    c.check("ngo update 200", city.status === 200, city.json);
    c.check("city saved", city.json?.data?.ngo?.city === "Kanpur");
    c.check("goes back to pending", city.json?.data?.user?.verification_status === "pending");

    const ngoOnPublic = await h.patch("/api/users/me", { first_name: "X" }, ngo.token);
    c.check("ngo blocked from citizen endpoint 403", ngoOnPublic.status === 403, ngoOnPublic.json);
    c.check("403 names the ngo endpoint", String(ngoOnPublic.json?.message).includes("/api/users/me/ngo"));
    const ngoOnPolice = await h.patch("/api/users/me/police", { police: { district: "X" } }, ngo.token);
    c.check("ngo blocked from police endpoint 403", ngoOnPolice.status === 403, ngoOnPolice.json);

    for (const field of ["org_name", "reg_number", "contact_mobile", "reg_certificate_files", "contact_person"]) {
        const res = await h.patch("/api/users/me/ngo", { ngo: { [field]: "HACKED" } }, ngo.token);
        c.check(`locked ngo field (${field}) 422`, res.status === 422, res.json?.errors);
    }
    const ngoAfter = await h.patch("/api/users/me/ngo", {}, ngo.token);
    c.check("ngo org_name survived", ngoAfter.json?.data?.ngo?.org_name?.startsWith("Org "));

    /* ---------------- auth ------------------------------------------------------ */
    c.section("auth");
    for (const path of ["/api/users/me", "/api/users/me/police", "/api/users/me/ngo"]) {
        const res = await h.patch(path, { first_name: "X" }, "not-a-real-token");
        c.check(`${path} with a bad token 401`, res.status === 401, res.status);
    }

    c.finish();
    await h.close();
    process.exit(c.fail > 0 ? 1 : 0);
};

run().catch((error) => {
    console.error("CRASH", error);
    process.exit(1);
});