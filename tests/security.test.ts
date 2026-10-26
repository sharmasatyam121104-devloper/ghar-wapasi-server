import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

const runId = `${process.pid}-${Date.now()}`;
const dbName = `ghar-wapsi-test-${runId}`;
const uploadsDir = path.join(os.tmpdir(), "ghar-wapsi-test-uploads", runId);

process.env.NODE_ENV = "test";
process.env.DB_URL = process.env.DB_URL || "mongodb://127.0.0.1:27017";
process.env.DB_NAME = dbName;
process.env.UPLOADS_DIR = uploadsDir;
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

let server: Server;
let baseUrl = "";
let mongoose: typeof import("mongoose").default;
let User: typeof import("../src/features/users/users.model").User;
let Complaint: typeof import("../src/features/complaints/complaints.model").Complaint;
let issueTokens: typeof import("../src/shared/tokens/jwt").issueTokens;

let sequence = 0;

const makeUser = async (
    role: "public" | "police" | "ngo" | "admin" | "superadmin",
    verificationStatus: "pending" | "verified" = "verified",
) => {
    sequence += 1;
    const suffix = String(sequence).padStart(2, "0");
    return User.create({
        first_name: `Test${sequence}`,
        last_name: role,
        aadhaar: `${String(Date.now()).slice(-10)}${suffix}`,
        mobile: `9${String(Date.now()).slice(-7)}${suffix}`,
        email: `security-${runId}-${sequence}@example.com`,
        password: "TestPassword123!",
        role,
        verification_status: verificationStatus,
        is_active: true,
    });
};

const tokenFor = (user: { _id: unknown; role: string; email: string }): string =>
    issueTokens({
        _id: String(user._id),
        role: user.role as "public" | "police" | "ngo" | "admin" | "superadmin",
        email: user.email,
    }).accessToken;

const makeComplaint = async (options: {
    ownerId: string;
    officerId: string;
    officerRole: "police" | "ngo";
    fileReference: string;
}) =>
    Complaint.create({
        case_ref: `GW-TEST-${runId}-${++sequence}`,
        person_name: "Missing Person",
        person_age: 30,
        person_gender: "female",
        last_seen_date: new Date("2026-01-01"),
        last_seen_place: "Bus stand",
        last_seen_city: "Patna",
        complainant_name: "Test Complainant",
        complainant_relation: "Sister",
        complainant_aadhaar: "123456789012",
        complainant_mobile: "9876543210",
        complainant_address: "Test address",
        member_name: "Missing Person",
        member_relation: "Self",
        member_aadhaar: "123456789013",
        member_mobile: "9876543211",
        police_station: "Test station",
        fir_number: "FIR-1",
        fir_date: new Date("2026-01-01"),
        person_photos: [options.fileReference],
        created_by: options.ownerId,
        created_by_role: "public",
        assigned_officer_id: options.officerId,
        assigned_officer_role: options.officerRole,
        status: "active",
        outcome: "ongoing",
        timeline: [],
    });

const api = (pathname: string, token: string, init: RequestInit = {}) =>
    fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...init.headers,
        },
    });

before(async () => {
    mongoose = (await import("mongoose")).default;
    ({ User } = await import("../src/features/users/users.model"));
    ({ Complaint } = await import("../src/features/complaints/complaints.model"));
    ({ issueTokens } = await import("../src/shared/tokens/jwt"));
    const { createApp } = await import("../src/app");

    await mongoose.connect(`${process.env.DB_URL}/${dbName}`);
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
});

test("unverified officer cannot open or mutate an assigned complaint", async () => {
    const owner = await makeUser("public", "verified");
    const officer = await makeUser("police", "pending");
    const complaint = await makeComplaint({
        ownerId: String(owner._id),
        officerId: String(officer._id),
        officerRole: "police",
        fileReference: `public/${owner._id}/proof.png`,
    });
    const token = tokenFor(officer);

    const list = await api("/api/complaints", token);
    assert.equal(list.status, 403);

    const detail = await api(`/api/complaints/${complaint._id}`, token);
    assert.equal(detail.status, 404);

    const update = await api(`/api/complaints/${complaint._id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ status: "resolved" }),
    });
    assert.equal(update.status, 403);

    const note = await api(`/api/complaints/${complaint._id}/notes`, token, {
        method: "POST",
        body: JSON.stringify({ body: "Should not be allowed" }),
    });
    assert.equal(note.status, 403);
});

test("superadmin can review a request in another admin's queue", async () => {
    const admin = await makeUser("admin");
    const officer = await makeUser("police", "pending");
    officer.assigned_admin_id = admin._id;
    await officer.save();

    const superadmin = await makeUser("superadmin");
    const token = tokenFor(superadmin);

    const list = await api("/api/verification/requests?verificationStatus=pending", token);
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { data: { users: { id: string }[] } };
    assert.ok(listBody.data.users.some((user) => user.id === String(officer._id)));

    const call = await api(`/api/verification/requests/${officer._id}/call`, token, {
        method: "POST",
        body: JSON.stringify({
            link: "https://meet.example.com/review",
            time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
    });
    assert.equal(call.status, 200);

    const approve = await api(`/api/verification/requests/${officer._id}/approve`, token, {
        method: "POST",
        body: JSON.stringify({}),
    });
    assert.equal(approve.status, 200);

    const reviewed = await User.findById(officer._id);
    assert.equal(reviewed?.verification_status, "verified");
});

test("login identifies both a superadmin and a normal admin for the UI router", async () => {
    const loginAs = async (email: string) => {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: email, password: "TestPassword123!" }),
        });
        assert.equal(response.status, 200);
        const body = (await response.json()) as {
            data: { user: { role: string; is_superadmin: boolean } };
        };
        return body.data.user;
    };

    const superadmin = await makeUser("superadmin");
    const admin = await makeUser("admin");

    const superadminIdentity = await loginAs(superadmin.email);
    assert.equal(superadminIdentity.role, "superadmin");
    assert.equal(superadminIdentity.is_superadmin, true);

    const adminIdentity = await loginAs(admin.email);
    assert.equal(adminIdentity.role, "admin");
    assert.equal(adminIdentity.is_superadmin, false);
});

test("only a superadmin can create an admin", async () => {
    const superadmin = await makeUser("superadmin");
    const superToken = tokenFor(superadmin);

    sequence += 1;
    const suffix = String(sequence).padStart(2, "0");
    const payload = {
        first_name: "Provisioned",
        last_name: "Admin",
        aadhaar: `${String(Date.now()).slice(-10)}${suffix}`,
        mobile: `9${String(Date.now()).slice(-7)}${suffix}`,
        email: `created-admin-${runId}-${sequence}@example.com`,
        password: "TestPassword123!",
    };

    const created = await api("/api/register/admin", superToken, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as {
        data: {
            user: { id: string; role: string; is_superadmin: boolean; verification_status: string };
            tokens?: unknown;
        };
    };
    assert.equal(createdBody.data.user.role, "admin");
    assert.equal(createdBody.data.user.is_superadmin, false);
    assert.equal(createdBody.data.user.verification_status, "verified");
    assert.equal(createdBody.data.tokens, undefined);

    const ordinaryAdmin = await makeUser("admin");
    const adminToken = tokenFor(ordinaryAdmin);

    const denied = await api("/api/register/admin", adminToken, {
        method: "POST",
        body: JSON.stringify({ ...payload, email: `denied-${runId}-${sequence}@example.com` }),
    });
    assert.equal(denied.status, 403);

    const anonymous = await fetch(`${baseUrl}/api/register/admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, email: `anonymous-${runId}-${sequence}@example.com` }),
    });
    assert.equal(anonymous.status, 401);
});

test("a superadmin can read only its own account", async () => {
    const superadmin = await makeUser("superadmin");
    const anotherSuperadmin = await makeUser("superadmin");
    const admin = await makeUser("admin");
    const police = await makeUser("police");
    const ngo = await makeUser("ngo");
    const publicUser = await makeUser("public");
    const token = tokenFor(superadmin);

    for (const target of [anotherSuperadmin, admin, police, ngo, publicUser]) {
        const detail = await api(`/api/users/${target._id}`, token);
        assert.equal(detail.status, 404, `superadmin must not read ${target.role} account ${target._id}`);
    }

    const ownDetail = await api(`/api/users/${superadmin._id}`, token);
    assert.equal(ownDetail.status, 200);

    const ownMe = await api("/api/users/me", token);
    assert.equal(ownMe.status, 200);

    const list = await api("/api/users?limit=100", token);
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { data: { users: { id: string }[] } };
    assert.deepEqual(listBody.data.users.map((user) => user.id), [String(superadmin._id)]);

    const adminList = await api("/api/users?role=admin&limit=100", token);
    assert.equal(adminList.status, 200);
    const adminListBody = (await adminList.json()) as { data: { users: { id: string }[] } };
    assert.deepEqual(adminListBody.data.users, []);
});

test("a normal admin can read only itself and its assigned staff", async () => {
    const admin = await makeUser("admin");
    const superadmin = await makeUser("superadmin");
    const otherAdmin = await makeUser("admin");
    const assignedPolice = await makeUser("police");
    assignedPolice.assigned_admin_id = admin._id;
    await assignedPolice.save();
    const unrelatedNgo = await makeUser("ngo");
    const token = tokenFor(admin);

    const ownDetail = await api(`/api/users/${admin._id}`, token);
    assert.equal(ownDetail.status, 200);

    const assignedDetail = await api(`/api/users/${assignedPolice._id}`, token);
    assert.equal(assignedDetail.status, 200);

    for (const target of [superadmin, otherAdmin, unrelatedNgo]) {
        const detail = await api(`/api/users/${target._id}`, token);
        assert.equal(detail.status, 404, `normal admin must not read ${target.role} account ${target._id}`);
    }

    const list = await api("/api/users?limit=100", token);
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { data: { users: { id: string }[] } };
    assert.deepEqual(
        new Set(listBody.data.users.map((user) => user.id)),
        new Set([String(admin._id), String(assignedPolice._id)]),
    );

    const superadminList = await api("/api/users?role=superadmin&limit=100", token);
    assert.equal(superadminList.status, 200);
    const superadminListBody = (await superadminList.json()) as { data: { users: { id: string }[] } };
    assert.deepEqual(superadminListBody.data.users, []);

    const adminList = await api("/api/users?role=admin&limit=100", token);
    assert.equal(adminList.status, 200);
    const adminListBody = (await adminList.json()) as { data: { users: { id: string }[] } };
    assert.deepEqual(adminListBody.data.users.map((user) => user.id), [String(admin._id)]);
});

test("non-admin roles cannot use the account directory or lookup", async () => {
    for (const role of ["public", "police", "ngo"] as const) {
        const viewer = await makeUser(role);
        const other = await makeUser("public");
        const token = tokenFor(viewer);

        const ownMe = await api("/api/users/me", token);
        assert.equal(ownMe.status, 200, `${role} must still be able to read its own account`);

        const detail = await api(`/api/users/${other._id}`, token);
        assert.equal(detail.status, 403);

        const list = await api("/api/users", token);
        assert.equal(list.status, 403);
    }
});

test("no HTTP registration endpoint can create another superadmin", async () => {
    const before = await User.countDocuments({ role: "superadmin" });
    const superadmin = await makeUser("superadmin");
    const superToken = tokenFor(superadmin);

    sequence += 1;
    const suffix = String(sequence).padStart(2, "0");
    const payload = {
        first_name: "Should",
        last_name: "NotExist",
        aadhaar: `${String(Date.now()).slice(-10)}${suffix}`,
        mobile: `9${String(Date.now()).slice(-7)}${suffix}`,
        email: `no-superadmin-${runId}-${sequence}@example.com`,
        password: "TestPassword123!",
        role: "superadmin",
    };

    const viaAdminEndpoint = await api("/api/register/admin", superToken, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    assert.equal(viaAdminEndpoint.status, 400);

    for (const endpoint of ["/api/register", "/api/register/police", "/api/register/ngo"]) {
        const response = await fetch(`${baseUrl}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        assert.equal(response.status, 400, `${endpoint} must reject a superadmin role`);
    }

    const ordinaryAdmin = await makeUser("admin");
    const adminToken = tokenFor(ordinaryAdmin);

    const deniedAdmin = await api("/api/register/admin", adminToken, {
        method: "POST",
        body: JSON.stringify({ ...payload, role: "admin" }),
    });
    assert.equal(deniedAdmin.status, 403);

    const deniedSuperadmin = await api("/api/register/admin", adminToken, {
        method: "POST",
        body: JSON.stringify(payload),
    });
    assert.equal(deniedSuperadmin.status, 403);

    const after = await User.countDocuments({ role: "superadmin" });
    assert.equal(after, before + 1, "only the explicitly created test superadmin may exist");
});

test("unverified officer cannot download case files, verified officer can", async () => {
    const owner = await makeUser("public", "verified");
    const officer = await makeUser("ngo", "pending");
    const fileReference = `public/${owner._id}/proof.png`;
    const absolute = path.join(uploadsDir, "public", String(owner._id), "proof.png");
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, "proof");

    await makeComplaint({
        ownerId: String(owner._id),
        officerId: String(officer._id),
        officerRole: "ngo",
        fileReference,
    });
    const token = tokenFor(officer);
    const fileUrl = `/api/files/${fileReference}`;

    const denied = await api(fileUrl, token);
    assert.equal(denied.status, 403);

    officer.verification_status = "verified";
    await officer.save();

    const allowed = await api(fileUrl, token);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("content-type"), "application/octet-stream");
    assert.equal(await allowed.text(), "proof");
});
