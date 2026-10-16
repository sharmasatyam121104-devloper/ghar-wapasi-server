import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { ApiError } from "../../shared/errors/ApiError";
import { asyncHandler } from "../../shared/http/asyncHandler";
import { currentUser, routeParam } from "../../shared/http/request";
import { sendSuccess } from "../../shared/http/response";
import { EXTENSION_BY_MIME, newTmpFileName, resolveStoredFile, tmpDirectory } from "./file.storage";

/** What multer writes to `req.files` for the disk storage engine. */
interface UploadedFile {
    filename: string;
    originalname: string;
    mimetype: string;
    size: number;
    path: string;
}

/**
 * Hands back `tmp/<name>` references. The client passes these into the
 * registration body; only then are they moved into the member's folder.
 *
 * The bytes decide the type here, not the multipart headers: `file-type` reads
 * the file's magic numbers, so a renamed HTML file labelled `image/png` is
 * rejected even though `fileFilter` let it through. Only the sniffed MIME gets
 * to pick the stored extension.
 */
export const uploadFiles = asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files as UploadedFile[] | undefined) ?? [];
    if (files.length === 0) {
        throw ApiError.unprocessable("Choose at least one file to upload.");
    }

    const { fileTypeFromBuffer } = await import("file-type");

    const detected: Array<{ file: UploadedFile; extension: string }> = [];
    for (const file of files) {
        const type = await fileTypeFromBuffer(await fs.promises.readFile(file.path));
        const extension = type ? EXTENSION_BY_MIME[type.mime] : undefined;

        if (!extension) {
            // None of this request's files has been handed a reference yet, so
            // dropping them all leaves nothing orphaned on disk.
            await Promise.all(files.map((item) => fs.promises.rm(item.path, { force: true })));
            throw ApiError.badRequest("Only JPG, PNG, WEBP or PDF files can be uploaded.");
        }

        detected.push({ file, extension });
    }

    // With a sniffed type in hand, the file gets its extension and the
    // `tmp/*` name the client is told about.
    for (const { file, extension } of detected) {
        const finalName = newTmpFileName(extension);
        await fs.promises.rename(file.path, path.join(tmpDirectory(), finalName));
        file.filename = finalName;
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

    // A stored document is downloaded, never rendered: the type is forced to
    // `application/octet-stream` and locked down, so an HTML/SVG upload cannot
    // execute as a same-origin page in a reviewer's browser.
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="file"');
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'");

    res.sendFile(absolute);
});
