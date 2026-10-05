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
21 paths, 23 operations - including which cookie or header authenticates each
one and the `503` every `/api` route returns when Mongo is unreachable.
