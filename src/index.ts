
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import morgan from "morgan";

import DBConnect from "./config/db.config";

const app = express();

DBConnect();

app.use(
    cors({
    origin: [
        process.env.CLIENT_URL || "http://localhost:5173",
        "http://localhost:3000",
    ],
    credentials: true,
    })
);

app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));



import UserRouter from "./modules/user/user.routes";


app.use('/user', UserRouter)

app.get("/", (_req, res) => {
    res.status(200).json({
    success: true,
    message: "ghar-wapasi-server is running successfully",
    });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`ghar-wapasi-server running on http://localhost:${PORT}`);
});
