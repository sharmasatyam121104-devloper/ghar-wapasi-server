// Side-effect import so every other module - including config/env - sees the
// .env values as it loads.
import "dotenv/config";

import { connectDatabase } from "./config/db.config";
import { env } from "./config/env.config";
import { createApp } from "./app";

const app = createApp();

// Listen first, connect second. The docs and /health have to answer even with
// no database, so a missing Mongo is a visible status and not a dead port.
const server = app.listen(env.port, () => {
    console.log(`ghar-wapasi-server running on http://localhost:${env.port}`);
    console.log(`API docs at http://localhost:${env.port}/docs`);
});

connectDatabase().catch((error: unknown) => {
    // connectDatabase already logs; this is the last line of defence so a
    // throw here can never take the listening server down with it.
    console.error("[db] unexpected failure:", error);
});

const shutdown = (signal: string): void => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => process.exit(0));
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));