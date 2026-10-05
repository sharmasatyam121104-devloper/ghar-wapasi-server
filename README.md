# Ghar Wapasi Server

Backend API for **Ghar Wapasi**, a platform designed to help identify missing and unidentified persons and reconnect them with their families.

## Tech Stack

* Node.js
* Express
* TypeScript
* MongoDB

## Modules

* User
* Family
* Police
* NGO
* Citizen
* Admin
* Super Admin
* OTP (`src/features/otp`)

## Contact changes need a code

Changing the `email` or `mobile` on an account goes through
`POST /api/otp/request` and `POST /api/otp/verify`. Confirming the code returns a
single-use `otp_token`, and that receipt - not the code - is what a profile
update has to send as `otp_token`. There is no `verified` flag a client can send
to shortcut it.

For a **citizen** that is the whole gate: the change applies immediately and the
account stays `verified`. A citizen's `first_name`/`last_name` need no code and
no review at all.

For **police and NGO** a correct code is not approval. The new address is held
in `pending_contact`, the live value is untouched, and the account goes back to
`pending` for the assigned admin to approve. Approval promotes the address;
rejection discards it.

A staff `first_name`/`last_name` change needs no code either, but it still goes
back for review - a member's name is part of what an admin vets, so it is
treated exactly like a profile field: the account is re-queued and the portal
stays shut until the admin approves. The 6 hour self-service window covers a
name as much as a profile field, so a verified officer cannot rename themselves
hours later and knock their own account out of `verified`.

The module itself knows nothing about profiles. Adding a flow - phone login,
say - means adding a value to `OTP_PURPOSES`, not a second set of rules.

Delivery is a provider per channel behind `resolveProvider`. The two shipped
providers only print the code to the console, and they refuse to run in
production: `isConfigured()` is `false` there, so the request answers `503`
instead of pretending to send, and `dev_code` is never added to the response.
Swap in a real transport with the same `send` signature and nothing above it
changes.

Policy is environment-driven, so the limits are not scattered through the code:

| Variable | Default | Meaning |
| --- | --- | --- |
| `OTP_TTL_SECONDS` | 600 | How long a code stays usable |
| `OTP_RESEND_COOLDOWN_SECONDS` | 60 | Wait before another code for the same purpose |
| `OTP_MAX_ATTEMPTS` | 5 | Wrong guesses allowed per code |
| `OTP_MAX_PER_HOUR` | 5 | Codes per account per purpose per hour |

## Setup

```bash
npm install
cp .env.example .env    # then fill in DB_URL and DB_NAME
npm run dev
```

The server starts on `http://localhost:8080` by default (see `PORT` in `.env`).

Mongo does not have to be running for the server to boot. Without it the process
comes up anyway, `/health` reports `"database":"disconnected"`, and every `/api`
route answers `503` - so the docs stay browsable while the database is down.

## API docs

Swagger UI: **http://localhost:8080/docs**

Raw spec: `http://localhost:8080/docs/openapi.json`

The spec is hand-written in `src/docs/openapi.ts` and covers the full surface -
23 paths, 25 operations - including which cookie or header authenticates each
one and the `503` every `/api` route returns when Mongo is unreachable.

## Tests

There is no test runner here, so the checks are plain scripts that boot the real
app against the real database. They add users, and they run one at a time.

```
npm test
```

That runs all six suites and prints a combined tally. Each suite needs its own
environment, which `tests/run-all.mjs` sets per file - the rate-limit suite
asserts the shipped default of 5 codes an hour and so must not have that limit
raised, while the main OTP suite spends far more than five codes on one account.
