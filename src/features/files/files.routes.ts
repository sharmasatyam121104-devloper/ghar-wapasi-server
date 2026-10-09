import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { ApiError } from "../../shared/errors/ApiError";
import { requireAuth } from "../../middleware/auth.middleware";
import { newTmpFileName, tmpDirectory } from "./file.storage";
import * as controller from "./files.controller";

/**
 * File endpoints.
 *
 *   POST /api/files                          multipart upload -> `tmp/<name>`
 *   GET  /api/files/:role/:userId/:filename  the stored document itself
 *
 * The upload is open because registration is open: a police or NGO sign-up
 * happens before the account exists. Files land in `uploads/tmp/` first and
 * only move into `uploads/<role>/<userId>/` once a registration references
 * them - see `file.storage.ts`.
 */

const MAX_FILES = 6;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDirectory()),
    filename: (_req, file, cb) => cb(null, newTmpFileName(file.originalname)),
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
        cb(new ApiError(422, "Only JPG, PNG, WEBP or PDF files can be uploaded."));
    },
});

/** Multer reports its own error shapes; translate them instead of a 500. */
const toUploadError = (error: unknown): ApiError => {
    if (error instanceof ApiError) return error;
    if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
            return ApiError.payloadTooLarge("Each file must be 2 MB or smaller.");
        }
        if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
            return ApiError.unprocessable(`You can upload at most ${MAX_FILES} files at once.`);
        }
        return ApiError.badRequest("The upload could not be read. Please choose the files again.");
    }
    if (error instanceof Error) return ApiError.badRequest(error.message);
    return ApiError.badRequest("The upload could not be read. Please choose the files again.");
};

const FilesRouter = Router();

FilesRouter.post("/", (req: Request, res: Response, next: NextFunction) => {
    upload.array("files", MAX_FILES)(req, res, (error: unknown) => {
        if (error) return next(toUploadError(error));
        controller.uploadFiles(req, res, next);
    });
});

FilesRouter.get("/:role/:userId/:filename", requireAuth, controller.downloadFile);

export default FilesRouter;
