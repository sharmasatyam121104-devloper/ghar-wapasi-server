/**
 * The API contract, written out by hand in one file.
 *
 * Hand-written rather than generated from JSDoc annotations: the whole surface
 * is 21 paths and 23 operations, and keeping the spec in a single readable
 * file makes it reviewable in the same diff as the routes it documents. Every
 * path here has a counterpart in the mounted routers; if they ever disagree,
 * the spec is wrong.
 *
 * Targets OpenAPI 3.0.3, which is what Swagger UI reads. Note the two
 * consequences that 3.0 imposes and 3.1 relaxed:
 *   - every response needs a `description`, so `ok()` below always sets one;
 *   - a nullable $ref is `{ nullable: true, allOf: [{ $ref }] }`, because
 *     `oneOf: [{ $ref }, { type: "null" }]` is 3.1 syntax and 3.0 ignores
 *     siblings of $ref.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/** A `$ref` that may also be null. See the note at the top of this file. */
const nullableRef = (name: string) => ({
    nullable: true,
    allOf: [{ $ref: `#/components/schemas/${name}` }],
});

const jsonSchema = (schema: Record<string, unknown>) => ({
    content: { "application/json": { schema } },
});

const errorResponse = (description: string) => ({
    description,
    ...jsonSchema(ref("Error")),
});

/** Reusable failure list, so each operation only names what is specific to it. */
const failures = {
    unauthorized: errorResponse("No valid session. The access token is missing, expired or revoked."),
    forbidden: errorResponse("Authenticated, but not allowed to do this."),
    notFound: errorResponse("No such record, or it does not belong to this admin."),
    unavailable: errorResponse(
        "The database is not reachable right now. Please try again shortly.",
    ),
} as const;

const jsonBody = (schema: Record<string, unknown>) => ({
    required: true,
    content: { "application/json": { schema } },
});

const optionalBody = (schema: Record<string, unknown>) => ({
    required: false,
    content: { "application/json": { schema } },
});

/**
 * A 2xx in the `sendSuccess` envelope: `{ success, message?, data }`.
 * `message` is only listed when the endpoint actually sends one.
 */
const ok = (
    description: string,
    data: Record<string, unknown>,
    messageExample?: string,
) => ({
    description,
    ...jsonSchema({
        type: "object",
        properties: {
            success: { type: "boolean", example: true },
            ...(messageExample ? { message: { type: "string", example: messageExample } } : {}),
            data,
        },
    }),
});

const paginated = (itemRef: string) => ({
    type: "object",
    properties: {
        users: { type: "array", items: ref(itemRef) },
        total: { type: "integer", example: 42 },
        page: { type: "integer", example: 1 },
        limit: { type: "integer", example: 20 },
        totalPages: { type: "integer", example: 3 },
    },
});

const pageParams = [
    {
        name: "page",
        in: "query",
        schema: { type: "integer", minimum: 1, default: 1 },
        description: "1-based page number. A non-numeric value falls back to 1.",
    },
    {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        description: "Rows per page, capped at 100.",
    },
    {
        name: "search",
        in: "query",
        schema: { type: "string" },
        description: "Case-insensitive partial match. Regex characters are escaped.",
    },
];

const userIdParam = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
    description: "The user's Mongo id.",
} as const;

export const openApiDocument = {
    openapi: "3.0.3",
    info: {
        title: "Ghar Wapsi API",
        version: "1.0.0",
        description: [
            "REST API for the Ghar Wapsi portal: citizen sign-up, police and NGO",
            "registration with admin verification, and the admin review console.",
            "",
            "### Response envelope",
            "Every 2xx is `{ success: true, message?, data? }`. Every failure is",
            "`{ success: false, message, errors? }`, where `errors` maps a field",
            "name to the problem with it - the frontend highlights those inputs.",
            "",
            "### Authenticating",
            "The browser session lives in the `access_token` httpOnly cookie, which",
            "`POST /api/auth/login` and `POST /api/auth/refresh` set for you. Send",
            'requests with credentials (`fetch` needs `credentials: "include"`).',
            "",
            "Native and scripted clients have no cookie jar: send the token as",
            "`Authorization: Bearer <accessToken>` instead. Both are accepted on",
            "every protected route; use the **Authorize** button to pick one.",
            "",
            "Tokens are still returned in the response body so a client can hold",
            "them however it likes. The `refresh_token` cookie is scoped to",
            "`/api/auth/refresh` only, so it is never sent with ordinary calls.",
            "",
            "### Roles",
            "`public` accounts are usable immediately. `police` and `ngo` accounts",
            "start `pending` and must be approved by an admin before their portal",
            "opens - `GET /api/users/me` still works while pending, so the applicant",
            "can read their status and fix a rejected submission.",
            "",
            "`admin` accounts are created by a `superadmin` through",
            "`POST /api/register/admin`, and start `verified`. `superadmin` is a step",
            "above that: it is the only role allowed to call that endpoint, and it is",
            "minted by the admin CLI rather than over HTTP, so no API route creates",
            "one. A superadmin is a provisioner only - it does not inherit the review",
            "console, which stays with `admin`.",
        ].join("\n"),
    },
    servers: [
        { url: "http://localhost:8080", description: "Local development" },
        { url: "https://api.gharwapsi.example", description: "Production" },
    ],
    tags: [
        { name: "System", description: "Liveness and the root banner." },
        { name: "Auth", description: "Login, refresh, logout, password." },
        { name: "Registration", description: "Public, police and NGO sign-up, and superadmin-only admin provisioning." },
        { name: "Profile", description: "The caller's own account." },
        { name: "Users", description: "Admin-only listing and lookup." },
        { name: "Verification", description: "Admin-only review queue for police and NGO." },
    ],
    components: {
        securitySchemes: {
            cookieAuth: {
                type: "apiKey",
                in: "cookie",
                name: "access_token",
                description: "Set automatically by /api/auth/login. The browser's default.",
            },
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
                description: "For native and scripted clients with no cookie jar.",
            },
        },
        schemas: {
            Error: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: false },
                    message: { type: "string", example: "Email or password is incorrect." },
                    errors: {
                        type: "object",
                        additionalProperties: { type: "string" },
                        description: "Field name to the problem with that field.",
                        example: { email: "This email is already registered." },
                    },
                },
            },
            Tokens: {
                type: "object",
                properties: {
                    accessToken: { type: "string", description: "Valid for 2 hours." },
                    refreshToken: {
                        type: "string",
                        description: "Valid for 7 days, single use - it rotates on every refresh.",
                    },
                },
            },
            User: {
                type: "object",
                description:
                    "A user as the API returns them. Never includes the password, and the Aadhaar only masked.",
                properties: {
                    id: { type: "string" },
                    name: { type: "string", example: "Asha Verma" },
                    first_name: { type: "string", example: "Asha" },
                    last_name: { type: "string", example: "Verma" },
                    role: {
                        type: "string",
                        enum: ["public", "police", "ngo", "admin", "superadmin"],
                    },
                    identifier: {
                        type: "string",
                        description:
                            "What this account can sign in with: the email, or the mobile when the account has none.",
                        example: "asha@example.com",
                    },
                    email: {
                        type: "string",
                        description: "Empty for a public account, which registers without one.",
                    },
                    aadhaar_masked: { type: "string", example: "XXXX XXXX 1234" },
                    mobile: { type: "string", example: "9876543210" },
                    adminId: {
                        type: "string",
                        description: "Only non-empty for an admin; the frontend scopes its console on this.",
                    },
                    verification_status: {
                        type: "string",
                        enum: ["pending", "verified", "rejected"],
                    },
                    is_active: { type: "boolean" },
                },
            },
            VerificationCall: {
                type: "object",
                properties: {
                    link: { type: "string", example: "https://meet.example.com/asha" },
                    time: { type: "string", format: "date-time" },
                    note: { type: "string" },
                },
            },
            PoliceProfile: {
                type: "object",
                properties: {
                    rank: { type: "string", example: "Sub-Inspector" },
                    badge_number: { type: "string" },
                    station_name: { type: "string" },
                    district: { type: "string" },
                    state: { type: "string" },
                    official_email: { type: "string" },
                    employee_id: { type: "string" },
                    joining_date: { type: "string", format: "date" },
                    reporting_officer: { type: "string" },
                    reporting_officer_contact: { type: "string" },
                    id_card_files: { type: "array", items: { type: "string" } },
                    appointment_proof_files: { type: "array", items: { type: "string" } },
                },
            },
            NgoProfile: {
                type: "object",
                properties: {
                    org_name: { type: "string" },
                    org_type: { type: "string" },
                    reg_number: { type: "string" },
                    state: { type: "string" },
                    district: { type: "string" },
                    city: { type: "string" },
                    address: { type: "string" },
                    contact_person: { type: "string" },
                    designation: { type: "string" },
                    contact_mobile: { type: "string" },
                    contact_email: { type: "string" },
                    website: { type: "string" },
                    contact_aadhaar: { type: "string" },
                    reg_certificate_files: { type: "array", items: { type: "string" } },
                    org_photo_files: { type: "array", items: { type: "string" } },
                },
            },
            LoginResult: {
                type: "object",
                properties: {
                    user: ref("User"),
                    tokens: ref("Tokens"),
                    pendingVerification: {
                        type: "boolean",
                        description: "True for a police or NGO account that is not verified yet.",
                    },
                    rejectionReason: {
                        type: "string",
                        description: "Present only when the account was rejected.",
                    },
                    updateWindowEndsAt: {
                        type: "string",
                        format: "date-time",
                        description: "End of the 6 hour self-service edit window, for staff accounts.",
                    },
                },
            },
            Me: {
                type: "object",
                properties: {
                    user: ref("User"),
                    police: nullableRef("PoliceProfile"),
                    ngo: nullableRef("NgoProfile"),
                    verification_call: nullableRef("VerificationCall"),
                    last_login: { type: "string", format: "date-time", nullable: true },
                    created_at: { type: "string", format: "date-time" },
                    verification_status: {
                        type: "string",
                        enum: ["pending", "verified", "rejected"],
                        description: "Police and NGO accounts only.",
                    },
                    rejection_reason: { type: "string", nullable: true },
                    submitted_at: { type: "string", format: "date-time", nullable: true },
                    update_window_ends_at: { type: "string", format: "date-time", nullable: true },
                    can_edit: {
                        type: "boolean",
                        description:
                            "Police and NGO only. True inside the 6 hour window, or whenever the account is not verified.",
                    },
                },
            },
            VerificationRecord: {
                allOf: [
                    ref("User"),
                    {
                        type: "object",
                        properties: {
                            aadhaar: { type: "string", example: "XXXX XXXX 1234" },
                            state: { type: "string" },
                            location: { type: "string", description: "City and district joined." },
                            organisation: {
                                type: "string",
                                description: "Police station, or the NGO name.",
                            },
                            roleLabel: { type: "string", example: "Police Officer" },
                            status: { type: "string", enum: ["pending", "verified", "rejected"] },
                            documents: { type: "array", items: { type: "string" } },
                            submitted_at: { type: "string", format: "date-time" },
                            rejection_reason: { type: "string", nullable: true },
                            reviewed_at: { type: "string", format: "date-time", nullable: true },
                            assigned_admin_id: { type: "string", nullable: true },
                            profile: {
                                description: "The police or NGO record, depending on the role.",
                                oneOf: [ref("PoliceProfile"), ref("NgoProfile")],
                            },
                            verification_call: nullableRef("VerificationCall"),
                        },
                    },
                ],
            },
        },
    },
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    paths: {
        "/": {
            get: {
                tags: ["System"],
                summary: "Service banner",
                security: [],
                responses: {
                    200: {
                        description: "The service is up.",
                        ...jsonSchema({
                            type: "object",
                            properties: {
                                success: { type: "boolean", example: true },
                                message: { type: "string" },
                                docs: { type: "string", example: "/docs" },
                            },
                        }),
                    },
                },
            },
        },
        "/health": {
            get: {
                tags: ["System"],
                summary: "Liveness and database status",
                description: [
                    "Stays `200` even when Mongo is down: the process is alive, which is",
                    "what a liveness probe needs to know. Use the `database` field for",
                    "readiness - it flips to `disconnected` when the connection is lost,",
                    "and every `/api` route answers `503` until it is back.",
                ].join("\n"),
                security: [],
                responses: {
                    200: {
                        description: "The service is up. Check `database` for readiness.",
                        ...jsonSchema({
                            type: "object",
                            properties: {
                                success: { type: "boolean", example: true },
                                status: { type: "string", example: "ok" },
                                env: { type: "string", example: "development" },
                                database: {
                                    type: "string",
                                    enum: ["connected", "disconnected"],
                                    example: "connected",
                                    description: "`disconnected` means every `/api` route will return 503.",
                                },
                            },
                        }),
                    },
                },
            },
        },
        "/api/auth/login": {
            post: {
                tags: ["Auth"],
                summary: "Sign in with an email, Aadhaar number or mobile",
                description: [
                    "Resolves the identifier against all three fields, so the single",
                    "login field works for every kind of account. Spaced and hyphenated",
                    "numbers (`1234 5678 9012`) and an explicit `+91` prefix are",
                    "normalised.",
                    "",
                    "Sets the `access_token` and `refresh_token` cookies and returns",
                    "both tokens in the body as well, for clients that do not use",
                    "cookies.",
                    "",
                    "An unknown account and a wrong password return the same 401, so",
                    "the endpoint cannot be used to discover which accounts exist.",
                ].join("\n"),
                security: [],
                requestBody: jsonBody({
                    type: "object",
                    required: ["identifier", "password"],
                    properties: {
                        identifier: {
                            type: "string",
                            description: "Email, 12-digit Aadhaar or 10-digit mobile.",
                            example: "9876543210",
                        },
                        password: { type: "string", format: "password" },
                    },
                }),
                responses: {
                    200: ok("Signed in.", ref("LoginResult"), "Logged in as public."),
                    400: errorResponse(
                        "The identifier matches no known shape, or the password is empty.",
                    ),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                    403: errorResponse("The account exists but has been deactivated."),
                },
            },
        },
        "/api/auth/refresh": {
            post: {
                tags: ["Auth"],
                summary: "Exchange a refresh token for a new pair",
                description: [
                    "Reads the refresh token from the request body, or from the",
                    "`refresh_token` cookie when the body omits it - the browser client",
                    "sends an empty body.",
                    "",
                    "Tokens rotate: only the newest one is accepted, and presenting an",
                    "older one means it leaked, so every session on that account is",
                    "dropped and the caller has to sign in again.",
                ].join("\n"),
                security: [],
                requestBody: optionalBody({
                    type: "object",
                    properties: {
                        refreshToken: {
                            type: "string",
                            description: "Optional when the cookie is being sent.",
                        },
                    },
                }),
                responses: {
                    200: ok("A new pair, and the cookies have been reset.", {
                        type: "object",
                        properties: { tokens: ref("Tokens") },
                    }),
                    401: errorResponse("Missing, expired, or no longer the newest refresh token."),
                    403: errorResponse("The account has been deactivated."),
                    503: failures.unavailable,
                },
            },
        },
        "/api/auth/logout": {
            post: {
                tags: ["Auth"],
                summary: "Sign out and clear the cookies",
                description: [
                    "Deliberately not behind authentication. If it were, an expired",
                    "access token would make logout fail with a 401 and leave the",
                    "cookie in place, so the browser would still look signed in.",
                    "",
                    "Revokes the stored refresh token when one is supplied, and always",
                    "clears both cookies - clearing them is what ends the local session.",
                ].join("\n"),
                security: [],
                requestBody: optionalBody({
                    type: "object",
                    properties: { refreshToken: { type: "string" } },
                }),
                responses: {
                    200: ok("Signed out.", { type: "object" }, "Signed out."),
                    503: failures.unavailable,
                },
            },
        },
        "/api/auth/forgot-password": {
            post: {
                tags: ["Auth"],
                summary: "Request a password reset",
                description: [
                    "Always succeeds, whether or not the account exists - a reset flow",
                    'that reports "not found" lets anyone enumerate registered users.',
                ].join("\n"),
                security: [],
                requestBody: jsonBody({
                    type: "object",
                    required: ["identifier"],
                    properties: {
                        identifier: { type: "string", description: "Email, Aadhaar or mobile." },
                    },
                }),
                responses: {
                    200: ok(
                        "Accepted.",
                        { type: "object" },
                        "If that account exists, a reset link has been sent.",
                    ),
                    400: errorResponse("The identifier matches no known shape."),
                    503: failures.unavailable,
                },
            },
        },
        "/api/auth/password": {
            post: {
                tags: ["Auth"],
                summary: "Change the caller's own password",
                description: [
                    "Requires the current password. Signing out every other device is",
                    "automatic, and it includes this one, so the cookies are cleared and",
                    "the caller has to sign in again.",
                ].join("\n"),
                requestBody: jsonBody({
                    type: "object",
                    required: ["current_password", "new_password"],
                    properties: {
                        current_password: { type: "string", format: "password" },
                        new_password: {
                            type: "string",
                            format: "password",
                            minLength: 6,
                            description: "At least 6 characters, and different from the current one.",
                        },
                    },
                }),
                responses: {
                    200: ok(
                        "Password changed.",
                        { type: "object" },
                        "Password changed. Please log in again on your other devices.",
                    ),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                    404: failures.notFound,
                    422: errorResponse("The current password is wrong, or the new one fails the rules."),
                },
            },
        },
        "/api/register": {
            post: {
                tags: ["Registration"],
                operationId: "registerPublic",
                summary: "Create a public account",
                description: [
                    "One endpoint per role: the role is fixed by the path, not by a",
                    "field in the body, so this form cannot create a police or NGO",
                    "account. Use `/api/register/police` or `/api/register/ngo` for those.",
                    "",
                    "A public account is usable immediately - it is created `verified`",
                    "and its portal opens straight away. Email is optional here; it is",
                    "the one identifier a public account can be signed in with besides",
                    "the mobile number.",
                    "",
                    "If the body still carries a `role`, it has to say `public` or the",
                    "request is rejected with a pointer to the right endpoint.",
                ].join("\n"),
                security: [],
                requestBody: jsonBody({
                    type: "object",
                    required: ["first_name", "last_name", "aadhaar", "mobile", "password"],
                    properties: {
                        first_name: { type: "string", example: "Asha" },
                        last_name: { type: "string", example: "Verma" },
                        aadhaar: { type: "string", example: "123456789012" },
                        mobile: { type: "string", example: "9876543210" },
                        email: { type: "string", example: "asha@example.com" },
                        password: { type: "string", format: "password", minLength: 6 },
                    },
                }),
                responses: {
                    201: ok(
                        "Account created.",
                        {
                            type: "object",
                            properties: {
                                user: ref("User"),
                                tokens: ref("Tokens"),
                            },
                        },
                        "Account created successfully.",
                    ),
                    400: errorResponse("The body carries a `role` that is not `public`."),
                    409: errorResponse("That Aadhaar, mobile or email is already registered."),
                    422: errorResponse("Some details are invalid. See `errors`."),
                    503: failures.unavailable,
                },
            },
        },
        "/api/register/police": {
            post: {
                tags: ["Registration"],
                operationId: "registerPolice",
                summary: "Create a police account",
                description: [
                    "Creates the account `pending` and queues it for admin review; the",
                    "officer's portal opens only once an admin approves it. The tokens",
                    "are returned and the cookies set straight away, so the caller can",
                    "reach `GET /api/users/me` to read the status while waiting.",
                    "",
                    "Every field of `police` is required, including `official_email` and",
                    "at least one `id_card_files` photo - that photo is what the admin",
                    "verifies against, so the account cannot be created without one.",
                ].join("\n"),
                security: [],
                requestBody: jsonBody({
                    type: "object",
                    required: ["first_name", "last_name", "aadhaar", "mobile", "email", "password", "police"],
                    properties: {
                        first_name: { type: "string", example: "Suraj" },
                        last_name: { type: "string", example: "Singh" },
                        aadhaar: { type: "string", example: "123456789012" },
                        mobile: { type: "string", example: "9876543210" },
                        email: { type: "string", example: "suraj.up@gov.in" },
                        password: { type: "string", format: "password", minLength: 6 },
                        police: ref("PoliceProfile"),
                    },
                }),
                responses: {
                    201: ok(
                        "Account created, awaiting review.",
                        {
                            type: "object",
                            properties: {
                                user: ref("User"),
                                tokens: ref("Tokens"),
                            },
                        },
                        "Account created successfully.",
                    ),
                    400: errorResponse("The body carries a `role` that is not `police`."),
                    409: errorResponse("That Aadhaar, mobile or email is already registered."),
                    422: errorResponse("Some details are invalid. See `errors`."),
                    503: failures.unavailable,
                },
            },
        },
        "/api/register/ngo": {
            post: {
                tags: ["Registration"],
                operationId: "registerNgo",
                summary: "Create an NGO account",
                description: [
                    "Creates the account `pending` and queues it for admin review; the",
                    "organisation's portal opens only once an admin approves it. The",
                    "tokens are returned and the cookies set straight away, so the",
                    "caller can reach `GET /api/users/me` to read the status while",
                    "waiting.",
                    "",
                    "Every field of `ngo` is required. `contact_email` and",
                    "`contact_aadhaar` are optional, but `contact_mobile` is how the",
                    "admin reaches the organisation during the viva call.",
                ].join("\n"),
                security: [],
                requestBody: jsonBody({
                    type: "object",
                    required: ["first_name", "last_name", "aadhaar", "mobile", "email", "password", "ngo"],
                    properties: {
                        first_name: { type: "string", example: "Neha" },
                        last_name: { type: "string", example: "Gupta" },
                        aadhaar: { type: "string", example: "123456789012" },
                        mobile: { type: "string", example: "9876543210" },
                        email: { type: "string", example: "neha@bachpan.org" },
                        password: { type: "string", format: "password", minLength: 6 },
                        ngo: ref("NgoProfile"),
                    },
                }),
                responses: {
                    201: ok(
                        "Account created, awaiting review.",
                        {
                            type: "object",
                            properties: {
                                user: ref("User"),
                                tokens: ref("Tokens"),
                            },
                        },
                        "Account created successfully.",
                    ),
                    400: errorResponse("The body carries a `role` that is not `ngo`."),
                    409: errorResponse("That Aadhaar, mobile or email is already registered."),
                    422: errorResponse("Some details are invalid. See `errors`."),
                    503: failures.unavailable,
                },
            },
        },
        "/api/register/admin": {
            post: {
                tags: ["Registration"],
                operationId: "registerAdmin",
                summary: "Create an admin account (superadmin only)",
                description: [
                    "Provisions another admin. Same fields as the public sign-up form and",
                    "nothing more - an admin has no police or NGO record to verify - but the",
                    "account is created `admin` and can sign in straight away.",
                    "",
                    "**Only a `superadmin` may call this.** An ordinary admin reviews",
                    "verification requests; it cannot mint more admins. Every other role,",
                    "signed in or not, gets 401 or 403.",
                    "",
                    "There is deliberately no endpoint for `superadmin` itself - those",
                    "accounts are minted by the admin CLI, so no HTTP request can create",
                    "one no matter which role it holds.",
                    "",
                    "Unlike the other three sign-ups this returns **no tokens and sets no",
                    "cookies**. The caller is a superadmin acting for somebody else, so",
                    "handing back a session would give them the new admin's identity and",
                    "kick them out of their own browser. The new admin signs in itself.",
                ].join("\n"),
                requestBody: jsonBody({
                    type: "object",
                    required: ["first_name", "last_name", "aadhaar", "mobile", "password"],
                    properties: {
                        first_name: { type: "string", example: "Ravi" },
                        last_name: { type: "string", example: "Menon" },
                        aadhaar: { type: "string", example: "123456789012" },
                        mobile: { type: "string", example: "9876543210" },
                        email: {
                            type: "string",
                            description: "Optional, exactly as on the public form.",
                            example: "ravi@gharwapsi.example",
                        },
                        password: { type: "string", format: "password", minLength: 6 },
                    },
                }),
                responses: {
                    201: ok(
                        "Admin account created. The new admin signs in for themselves.",
                        {
                            type: "object",
                            properties: { user: ref("User") },
                        },
                        "Admin account created successfully.",
                    ),
                    400: errorResponse("The body carries a `role` that is not `admin`."),
                    401: failures.unauthorized,
                    403: failures.forbidden,
                    409: errorResponse("That Aadhaar, mobile or email is already registered."),
                    422: errorResponse("Some details are invalid. See `errors`."),
                    503: failures.unavailable,
                },
            },
        },
        "/api/users/me": {
            get: {
                tags: ["Profile"],
                summary: "The caller's own account",
                description:
                    "Works for a pending or rejected police/NGO account too - that is how the applicant reads their status and fixes a rejected submission.",
                responses: {
                    200: ok("The caller's own record.", ref("Me")),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                },
            },
            patch: {
                tags: ["Profile"],
                summary: "Update the caller's own account (citizen - no approval)",
                description: [
                    "Only the fields present in the body are touched.",
                    "",
                    "**No admin approval.** A public citizen was never vetted, so there is",
                    "nothing to re-approve. `first_name`, `last_name`, `mobile` and `email`",
                    "go in and the account stays `verified`.",
                    "",
                    "Police and NGO members get `403` here and must use their own endpoint -",
                    "`PATCH /api/users/me/police` or `PATCH /api/users/me/ngo` - because those",
                    "re-queue the account for an admin review.",
                ].join("\n"),
                requestBody: jsonBody({
                    type: "object",
                    properties: {
                        first_name: { type: "string" },
                        last_name: { type: "string" },
                        mobile: { type: "string", example: "9876543210" },
                        email: { type: "string" },
                    },
                }),
                responses: {
                    200: ok("Updated.", ref("Me"), "Profile updated successfully."),
                    401: failures.unauthorized,
                    403: errorResponse("A police or NGO account has to use its own update endpoint."),
                    409: errorResponse("That mobile or email belongs to another account."),
                    422: errorResponse("Some details are invalid. See `errors`."),
                    503: failures.unavailable,
                },
            },
        },
        "/api/users/me/police": {
            patch: {
                tags: ["Profile"],
                summary: "Update the caller's own police profile (admin reviews it)",
                description: [
                    "Police accounts only. Anything else gets `403`.",
                    "",
                    "**Admin approval is required.** An accepted change puts the account back",
                    "to `pending`, clears the previous decision, resets `submitted_at` and",
                    "re-queues it in the assigned admin's queue. The portal stays shut until",
                    "the admin approves again, and approval itself needs a meeting link and",
                    "time.",
                    "",
                    "**Only `district` and `reporting_officer_contact` are editable.** Every",
                    "field the admin actually checks comes back as `422` if sent:",
                    "",
                    "  editable  `district`, `reporting_officer_contact`",
                    "",
                    "  locked    `rank`, `badge_number`, `station_name`, `state`,",
                    "            `official_email`, `employee_id`, `joining_date`,",
                    "            `reporting_officer`, `id_card_files`,",
                    "            `appointment_proof_files`",
                    "",
                    "That is on purpose: if a verified officer could edit their own ID card",
                    "photo or service record they could replace the very documents they were",
                    "approved on. A locked field is reported by name rather than quietly",
                    "dropped, and one locked field rejects the whole request.",
                    "",
                    "A verified account only has the 6 hour window that starts at submission;",
                    "after that it gets `403` until an admin intervenes. A pending or rejected",
                    "account may always fix and resubmit.",
                ].join("\n"),
                requestBody: jsonBody({
                    type: "object",
                    properties: {
                        first_name: { type: "string" },
                        last_name: { type: "string" },
                        mobile: { type: "string", example: "9876543210" },
                        email: { type: "string" },
                        police: {
                            type: "object",
                            description:
                                "Only the editable police fields are accepted. See the description above.",
                            properties: {
                                district: { type: "string", example: "Lucknow" },
                                reporting_officer_contact: {
                                    type: "string",
                                    example: "9876500000",
                                },
                            },
                            additionalProperties: {
                                type: "string",
                                description: "Rejected with 422 - these are admin-verified.",
                            },
                        },
                    },
                }),
                responses: {
                    200: ok(
                        "Updated and re-queued for review.",
                        ref("Me"),
                        "Profile updated. An admin has to review it before your portal opens again.",
                    ),
                    401: failures.unauthorized,
                    403: errorResponse(
                        "Not a police account, or the 6 hour update window has closed for this verified account.",
                    ),
                    409: errorResponse("That mobile or email belongs to another account."),
                    422: errorResponse(
                        "Some details are invalid, or a locked admin-verified profile field was sent. See `errors`.",
                    ),
                    503: failures.unavailable,
                },
            },
        },
        "/api/users/me/ngo": {
            patch: {
                tags: ["Profile"],
                summary: "Update the caller's own NGO profile (admin reviews it)",
                description: [
                    "NGO accounts only. Anything else gets `403`.",
                    "",
                    "**Admin approval is required**, exactly as for police: an accepted change",
                    "puts the account back to `pending`, clears the previous decision, resets",
                    "`submitted_at` and re-queues it for the assigned admin.",
                    "",
                    "**Only the descriptive fields are editable.** Everything the admin checks",
                    "comes back as `422` if sent:",
                    "",
                    "  editable  `address`, `city`, `district`, `website`, `designation`,",
                    "            `contact_email`",
                    "",
                    "  locked    `org_name`, `org_type`, `reg_number`, `state`,",
                    "            `contact_person`, `contact_mobile`, `contact_aadhaar`,",
                    "            `reg_certificate_files`, `org_photo_files`",
                    "",
                    "A locked field is reported by name rather than quietly dropped, and one",
                    "locked field rejects the whole request.",
                    "",
                    "A verified account only has the 6 hour window that starts at submission;",
                    "after that it gets `403` until an admin intervenes. A pending or rejected",
                    "account may always fix and resubmit.",
                ].join("\n"),
                requestBody: jsonBody({
                    type: "object",
                    properties: {
                        first_name: { type: "string" },
                        last_name: { type: "string" },
                        mobile: { type: "string", example: "9876543210" },
                        email: { type: "string" },
                        ngo: {
                            type: "object",
                            description: "Only the editable NGO fields are accepted.",
                            properties: {
                                address: { type: "string" },
                                city: { type: "string" },
                                district: { type: "string" },
                                website: { type: "string" },
                                designation: { type: "string" },
                                contact_email: { type: "string" },
                            },
                            additionalProperties: {
                                type: "string",
                                description: "Rejected with 422 - these are admin-verified.",
                            },
                        },
                    },
                }),
                responses: {
                    200: ok(
                        "Updated and re-queued for review.",
                        ref("Me"),
                        "Profile updated. An admin has to review it before your portal opens again.",
                    ),
                    401: failures.unauthorized,
                    403: errorResponse(
                        "Not an NGO account, or the 6 hour update window has closed for this verified account.",
                    ),
                    409: errorResponse("That mobile or email belongs to another account."),
                    422: errorResponse(
                        "Some details are invalid, or a locked admin-verified profile field was sent. See `errors`.",
                    ),
                    503: failures.unavailable,
                },
            },
        },
        "/api/users": {
            get: {
                tags: ["Users"],
                summary: "List accounts (admin only)",
                parameters: [
                    ...pageParams,
                    {
                        name: "role",
                        in: "query",
                        schema: {
                            type: "string",
                            enum: ["public", "police", "ngo", "admin", "superadmin"],
                        },
                    },
                    {
                        name: "verificationStatus",
                        in: "query",
                        schema: { type: "string", enum: ["pending", "verified", "rejected"] },
                    },
                ],
                responses: {
                    200: ok("A page of accounts.", paginated("User")),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                    403: failures.forbidden,
                },
            },
        },
        "/api/users/{id}": {
            get: {
                tags: ["Users"],
                summary: "Fetch one account (admin only)",
                parameters: [userIdParam],
                responses: {
                    200: ok("The account.", ref("User")),
                    400: errorResponse("The id is not a valid Mongo id."),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                    403: failures.forbidden,
                    404: failures.notFound,
                },
            },
        },
        "/api/verification/requests": {
            get: {
                tags: ["Verification"],
                summary: "The caller's review queue (admin only)",
                description:
                    "Scoped to the signed-in admin's own queue. An admin cannot read another admin's queue, and the check is repeated per request, not only here.",
                parameters: [
                    ...pageParams,
                    {
                        name: "verificationStatus",
                        in: "query",
                        schema: { type: "string", enum: ["pending", "verified", "rejected"] },
                    },
                ],
                responses: {
                    200: ok("A page of the admin's queue.", paginated("VerificationRecord")),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                    403: failures.forbidden,
                },
            },
        },
        "/api/verification/requests/{id}": {
            get: {
                tags: ["Verification"],
                summary: "One verification request (admin only)",
                parameters: [userIdParam],
                responses: {
                    200: ok("The verification request.", ref("VerificationRecord")),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                    403: failures.forbidden,
                    404: failures.notFound,
                },
            },
        },
        "/api/verification/requests/{id}/call": {
            post: {
                tags: ["Verification"],
                summary: "Schedule the verification call (admin only)",
                description:
                    "The admin owns the slot; the applicant never picks their own time. The link must be http or https, and the time must parse and be in the future.",
                parameters: [userIdParam],
                requestBody: jsonBody({
                    type: "object",
                    required: ["link", "time"],
                    properties: {
                        link: { type: "string", example: "https://meet.example.com/asha" },
                        time: { type: "string", format: "date-time" },
                        note: { type: "string", maxLength: 500 },
                    },
                }),
                responses: {
                    200: ok(
                        "Call scheduled.",
                        ref("VerificationRecord"),
                        "Video call scheduled. The user can now see the link and time you set.",
                    ),
                    400: errorResponse(
                        "The link is missing, not http(s), or the time is unreadable or in the past.",
                    ),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                    403: failures.forbidden,
                    404: failures.notFound,
                },
            },
            delete: {
                tags: ["Verification"],
                summary: "Clear the scheduled call (admin only)",
                parameters: [userIdParam],
                responses: {
                    200: ok(
                        "Call cleared.",
                        ref("VerificationRecord"),
                        "Scheduled call cleared.",
                    ),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                    403: failures.forbidden,
                    404: failures.notFound,
                    409: errorResponse("There was no scheduled call to clear."),
                },
            },
        },
        "/api/verification/requests/{id}/approve": {
            post: {
                tags: ["Verification"],
                summary: "Approve a police or NGO account (admin only)",
                description:
                    "Blocked until the admin has supplied both a meeting link and a time - approval is a statement that the viva actually happened.",
                parameters: [userIdParam],
                responses: {
                    200: ok("Approved.", ref("VerificationRecord"), "Account verified."),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                    403: failures.forbidden,
                    404: failures.notFound,
                    409: errorResponse("This account is already verified."),
                    422: errorResponse("No meeting link or time has been set yet."),
                },
            },
        },
        "/api/verification/requests/{id}/reject": {
            post: {
                tags: ["Verification"],
                summary: "Reject a police or NGO account (admin only)",
                description:
                    "A scheduled call is not required to reject. The reason is shown to the applicant, so it has to be at least 10 characters.",
                parameters: [userIdParam],
                requestBody: jsonBody({
                    type: "object",
                    required: ["reason"],
                    properties: {
                        reason: {
                            type: "string",
                            minLength: 10,
                            example: "The ID card photo is unreadable, please upload it again.",
                        },
                    },
                }),
                responses: {
                    200: ok("Rejected.", ref("VerificationRecord"), "Registration rejected."),
                    401: failures.unauthorized,
                    503: failures.unavailable,
                    403: failures.forbidden,
                    404: failures.notFound,
                    422: errorResponse("The reason is shorter than 10 characters."),
                },
            },
        },
    },
} as const;