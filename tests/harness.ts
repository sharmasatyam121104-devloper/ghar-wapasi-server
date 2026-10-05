import "dotenv/config";
import { createServer, type Server } from "node:http";
import mongoose from "mongoose";
import { createApp } from "../src/app";
import { connectDatabase } from "../src/config/db.config";

/**
 * Shared harness for the check scripts in this folder.
 *
 * There is no test runner in this project, so these are plain scripts: boot the
 * real Express app against the real database, talk to it over HTTP and assert on
 * the responses. Run one with `npx tsx tests/<file>.ts`.
 *
 * `tsconfig.json` includes only `src`, so nothing here is compiled into `dist`.
 */

export interface Result {
    status: number;
    json: Record<string, any>;
}

export interface Harness {
    base: string;
    post: (path: string, body?: unknown, token?: string) => Promise<Result>;
    patch: (path: string, body: unknown, token: string) => Promise<Result>;
    get: (path: string, token: string) => Promise<Result>;
    close: () => Promise<void>;
}

/** Counts pass/fail and prints one line per check. */
export class Checks {
    public pass = 0;
    public fail = 0;

    public check(name: string, condition: boolean, extra?: unknown): void {
        if (condition) {
            this.pass++;
            console.log(`  PASS  ${name}`);
        } else {
            this.fail++;
            console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
        }
    }

    public section(title: string): void {
        console.log(`\n[${title}]`);
    }

    public finish(): void {
        console.log(`\n=== ${this.pass} passed, ${this.fail} failed ===`);
    }
}

export const boot = async (): Promise<Harness> => {
    await connectDatabase();
    const server: Server = createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const send = async (method: string, path: string, body?: unknown, token?: string): Promise<Result> => {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: res.status, json: (await res.json()) as Record<string, any> };
    };

    return {
        base,
        post: (path, body, token) => send("POST", path, body, token),
        patch: (path, body, token) => send("PATCH", path, body, token),
        get: (path, token) => send("GET", path, undefined, token),
        close: async () => {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            await mongoose.disconnect();
        },
    };
};

/** Unique enough for a repeated run against a database that is never cleaned. */
export const unique = () => Date.now().toString().slice(-7);

/**
 * Exactly 12 digits, and exactly 10 for the mobile. Built by padding rather than
 * concatenation so a change to `unique()` cannot silently produce 11 digits -
 * which reads as a confusing "Enter a valid 12-digit Aadhaar number." 422.
 */
export const aadhaarFor = (suffix: string): string =>
    `99${unique()}${suffix}`.slice(0, 12).padEnd(12, "0");

export const mobileFor = (suffix: string): string =>
    `97${unique()}${suffix}`.slice(0, 10).padEnd(10, "0");

/** A fresh, unused 10-digit number for an OTP target. */
export const freeMobile = (): string => `95${unique()}`.slice(0, 10).padEnd(10, "0");
/** A fresh, unused address for an OTP target. */
export const freeEmail = (tag: string): string => `target.${tag}.${unique()}@example.com`;

/**
 * Registers a public account and returns its token.
 *
 * `tag` is a single digit: it is used to build the Aadhaar and mobile numbers,
 * so it has to stay numeric.
 */
export const registerPublic = async (h: Harness, tag: string) => {
    const res = await h.post("/api/register", {
        first_name: "Test",
        last_name: tag,
        aadhaar: aadhaarFor(tag),
        mobile: mobileFor(tag),
        password: "secret123",
    });
    return { res, token: res.json?.data?.tokens?.accessToken as string };
};

/** Registers a police account and returns its token. */
export const registerPolice = async (h: Harness, tag: string) => {
    const res = await h.post("/api/register/police", {
        first_name: "Test",
        last_name: tag,
        aadhaar: aadhaarFor(tag),
        mobile: mobileFor(tag),
        password: "secret123",
        email: `police.${tag}.${unique()}@example.com`,
        police: {
            rank: "Constable",
            badge_number: `B-${tag}`,
            station_name: "Central",
            state: "UP",
            employee_id: `EMP${tag}`,
            joining_date: "2024-01-15",
            reporting_officer: "SI Sharma",
            official_email: `si.${tag}@example.com`,
            id_card_files: ["https://example.com/id.jpg"],
            district: "Lucknow",
        },
    });
    return { res, token: res.json?.data?.tokens?.accessToken as string };
};

/** Registers an NGO account and returns its token. */
export const registerNgo = async (h: Harness, tag: string) => {
    const res = await h.post("/api/register/ngo", {
        first_name: "Test",
        last_name: tag,
        aadhaar: aadhaarFor(tag),
        mobile: mobileFor(tag),
        password: "secret123",
        email: `ngo.${tag}.${unique()}@example.com`,
        ngo: {
            org_name: `Org ${tag}`,
            state: "UP",
            contact_person: "Ravi",
            contact_mobile: "9988776655",
            city: "Lucknow",
        },
    });
    return { res, token: res.json?.data?.tokens?.accessToken as string };
};

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));