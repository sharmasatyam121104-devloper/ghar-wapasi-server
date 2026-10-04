import cors from "cors";
import express, { type Express } from "express";
import morgan from "morgan";
import { isDatabaseReady } from "./config/db.config";
import { env } from "./config/env.config";
import { mountDocs } from "./docs/swagger";
import { requireDatabase } from "./middleware/database.middleware";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import apiRoutes from "./routes";

/** Builds the Express app without starting a server, so it stays testable. */
export const createApp = (): Express => {
    const app = express();

    app.use(
        cors({
            origin: [env.clientUrl, "http://localhost:3000"],
            credentials: true,
        }),
    );

    app.use(morgan("dev"));
    app.use(express.json({ limit: "2mb" }));
    app.use(express.urlencoded({ extended: true }));

    // Interactive docs plus the raw spec. Before `/api`, so `/docs` is never
    // swallowed by the API router. Deliberately not behind the database guard:
    // the contract has to be readable even when Mongo is down.
    mountDocs(app);

    app.get("/", (_req, res) => {
        res.status(200).json({
            success: true,
            message: "ghar-wapasi-server is running successfully",
            docs: "/docs",
        });
    });

    app.get("/health", (_req, res) => {
        // Always 200: this reports that the process is alive. `database` is the
        // signal for readiness, so a load balancer can act on it separately.
        res.status(200).json({
            success: true,
            status: "ok",
            env: env.nodeEnv,
            database: isDatabaseReady() ? "connected" : "disconnected",
        });
    });

    app.use("/api", requireDatabase, apiRoutes);

    // Anything unmatched, then the single error formatter for the whole app.
    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
};
