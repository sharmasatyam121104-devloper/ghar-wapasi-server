import mongoose from "mongoose";
import { env } from "./env.config";

/** How long to wait for a reachable Mongo before deciding it is not there. */
const CONNECT_TIMEOUT_MS = 5000;

/**
 * Connects to Mongo, but never exits the process. The HTTP server comes up
 * regardless, so the docs and `/health` stay reachable and a missing database
 * shows up as a visible status instead of a dead port.
 *
 * Mongoose's `error` and `disconnected` events are consumed here on purpose:
 * an unhandled `error` on the connection takes the whole process down, which
 * would take the docs offline the moment the database blips.
 */
export const connectDatabase = async (): Promise<boolean> => {
    const { dbUrl, dbName } = env;

    if (!dbUrl || !dbName) {
        console.error("[db] DB_URL and DB_NAME must both be set in .env.");
        return false;
    }

    mongoose.connection.on("error", (error: Error) => {
        console.error(`[db] ${error.message}`);
    });
    mongoose.connection.on("disconnected", () => {
        console.warn("[db] disconnected - data routes will answer 503 until it is back");
    });

    try {
        await mongoose.connect(`${dbUrl}/${dbName}`, {
            serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
        });
        console.log(`[db] connected to "${dbName}"`);
        return true;
    } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown error";
        console.error(`[db] could not connect: ${reason}`);
        console.warn("[db] starting without a database - see /health for the live status");
        return false;
    }
};

/** True only while queries can actually run. */
export const isDatabaseReady = (): boolean => mongoose.connection.readyState === 1;