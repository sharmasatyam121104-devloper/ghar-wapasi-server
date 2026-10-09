import fs from "node:fs";
import type { Request, Response } from "express";
import { ApiError } from "../../shared/errors/ApiError";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { currentUser, routeParam } from "../../shared/http/request";
import { sendSuccess } from "../../shared/http/response";
import { resolveStoredFile } from "./file.storage";

/** What multer writes to `req.files` for the disk storage engine. */
interface UploadedFile {
    filename: string;
    originalname: string;
    mimetype: string;
    size: number;
}

/**
 * Hands back `tmp/<name>` references. The client passes these into the
 * registration body; only then are they moved into the member's folder.
 */
export const uploadFiles = asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files as UploadedFile[] | undefined) ?? [];
    if (files.length === 0) {
        throw ApiError.unprocessable("Choose at least one file to upload.");
    }

    sendSuccess(
        res,
        {
            files: files.map((file) => ({
                ref: `tmp/${file.filename}`,
                name: file.originalname,
                size: file.size,
                mime: file.mimetype,
            })),
        },
        { message: "Files uploaded." },
    );
});

/**
 * Serves one stored document. Admins reviewing a registration may open any
 * file; everyone else may only open a file from their own folder.
 */
export const downloadFile = asyncHandler(async (req: Request, res: Response) => {
    const role = routeParam(req, "role");
    const userId = routeParam(req, "userId");
    const fileName = routeParam(req, "filename");

    const absolute = resolveStoredFile(role, userId, fileName);
    if (!absolute || !fs.existsSync(absolute)) {
        throw ApiError.notFound("File not found.");
    }

    const viewer = currentUser(req);
    const isAdmin = viewer.role === "admin" || viewer.role === "superadmin";
    if (!isAdmin && String(viewer._id) !== userId) {
        throw ApiError.forbidden("You are not allowed to view this file.");
    }

    res.sendFile(absolute);
});
