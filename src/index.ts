// Side-effect import so every other module - including config/env - sees the
// .env values as it loads.
import "dotenv/config";

import DBConnect from "./config/db.config";
import { env } from "./config/env.config";
import { createApp } from "./app";

DBConnect();

const app = createApp();

app.listen(env.port, () => {
    console.log(`ghar-wapasi-server running on http://localhost:${env.port}`);
});
