import swaggerUi from "swagger-ui-express";
import type { Express, Request, Response } from "express";
import { openApiDocument } from "./openapi";

/**
 * Behaviour of the docs page itself. These belong to the Swagger UI runtime,
 * not to the wrapper, so they go inside `swaggerOptions`.
 */
const UI_OPTIONS: swaggerUi.SwaggerOptions = {
    // Try the cookie session by default, since that is what the web client uses.
    // "Authorize" switches to the bearer scheme without leaving the page.
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: "list",
    tryItOutEnabled: true,
};

/**
 * Serves the interactive docs at `/docs` and the raw spec at
 * `/docs/openapi.json`, so the same contract can be imported into Postman or
 * used to generate a client. Mounted before the API so a stray `/docs` call
 * cannot fall through to the 404 handler.
 */
export const mountDocs = (app: Express): void => {
    app.get("/docs/openapi.json", (_req: Request, res: Response) => {
        res.status(200).json(openApiDocument);
    });

    app.use(
        "/docs",
        swaggerUi.serve,
        swaggerUi.setup(openApiDocument, {
            customSiteTitle: "Ghar Wapsi API",
            swaggerOptions: UI_OPTIONS,
        }),
    );
};