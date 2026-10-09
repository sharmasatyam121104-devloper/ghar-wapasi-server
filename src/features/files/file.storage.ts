import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ApiError } from "../../shared/errors/ApiError";
import { env } from "../../config/env.config";

/**
 * Document storage on disk - deliberately outside `src`, laid out exactly as
 * the business reads it:
 *
 *   uploads/tmp/<random>.<ext>          a file waiting for a registration
 *   uploads/<role>/<userId>/<file>      a member's own folder
 *
 * A registration references `tmp/*` files, and only when the account is
 * about to be written do we move them into the member's folder and keep the
 * relative path (`<role>/<userId>/<file>`) in the database.
 */

export const STORAGE_ROLES = ["public", "police", "ngo"] as const;
export type StorageRole = (typeof STORAGE_ROLES)[number];

export const isStorageRole = (value: string): value is StorageRole =>
    (STORAGE_ROLES as readonly string[]).includes(value);

/** uploads/, uploads/tmp and uploads/{public,police,ngo} exist before the first request. */
export const ensureUploadDirectories = (): void => {
    fs.mkdirSync(path.join(env.uploadsDir, "tmp"), { recursive: true });
    for (const role of STORAGE_ROLES) {
        fs.mkdirSync(path.join(env.uploadsDir, role), { recursive: true });
    }
};

export const tmpDirectory = (): string => path.join(env.uploadsDir, "tmp");

/** `<random>.<ext>` written by multer; the client only ever sees `tmp/<name>`. */
export const newTmpFileName = (originalName: string): string => {
    const extension = path.extname(originalName).toLowerCase().slice(0, 10);
    return `${randomBytes(12).toString("hex")}${extension}`;
};

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const TMP_REFERENCE = /^tmp\/([A-Za-z0-9._-]+)$/;

/** Pulls the file name out of a `tmp/<name>` reference, or null when malformed. */
export const parseTmpReference = (reference: unknown): string | null => {
    if (typeof reference !== "string") return null;
    const match = TMP_REFERENCE.exec(reference.trim());
    return match ? match[1] : null;
};

export const userDirectory = (role: StorageRole, userId: string): string =>
    path.join(env.uploadsDir, role, userId);

const uniqueFileName = (directory: string, name: string): string => {
    if (!fs.existsSync(path.join(directory, name))) return name;
    const extension = path.extname(name);
    const base = name.slice(0, name.length - extension.length);
    let counter = 1;
    while (fs.existsSync(path.join(directory, `${base}-${counter}${extension}`))) counter += 1;
    return `${base}-${counter}${extension}`;
};

/**
 * Moves the given groups of `tmp/*` references into the member's own folder
 * and returns the stored paths relative to the uploads root - exactly what the
 * database keeps and the file API serves.
 *
 * All-or-nothing: a failure removes whatever this call already moved, so a
 * rejected registration never leaves a half-filled folder behind.
 */
export const assignUploadGroups = async (
    role: StorageRole,
    userId: string,
    groups: Record<string, unknown>,
): Promise<Record<string, string[]>> => {
    const directory = userDirectory(role, userId);
    const stored: Record<string, string[]> = {};
    const moved: string[] = [];

    try {
        for (const [group, value] of Object.entries(groups)) {
            stored[group] = [];
            const references = Array.isArray(value) ? value : [];
            for (const reference of references) {
                const name = parseTmpReference(reference);
                if (!name) {
                    throw ApiError.unprocessable(
                        "One of the uploaded files could not be found. Please upload it again.",
                    );
                }
                const source = path.join(tmpDirectory(), name);
                if (!fs.existsSync(source)) {
                    throw ApiError.unprocessable(
                        "An uploaded file is no longer available. Please upload it again.",
                    );
                }
                fs.mkdirSync(directory, { recursive: true });
                const finalName = uniqueFileName(directory, name);
                fs.renameSync(source, path.join(directory, finalName));
                const relative = `${role}/${userId}/${finalName}`;
                moved.push(relative);
                stored[group].push(relative);
            }
        }
    } catch (error) {
        for (const relative of moved) {
            fs.rmSync(path.join(env.uploadsDir, relative), { force: true });
        }
        throw error;
    }

    return stored;
};

/** Removes a member's whole folder - used when the user write fails right after the move. */
export const deleteUserDirectory = (role: StorageRole, userId: string): void => {
    fs.rmSync(userDirectory(role, userId), { recursive: true, force: true });
};

/**
 * Removes specific stored files - the counterpart to `assignUploadGroups` for a
 * write that failed *after* the move. Unlike `deleteUserDirectory` this leaves
 * the member's other documents alone, which matters when one folder holds the
 * files of several records (a member's profile plus every complaint they filed).
 */
export const removeStoredFiles = (references: string[]): void => {
    for (const reference of references) {
        const parts = reference.split("/");
        if (parts.length !== 3) continue;
        const absolute = resolveStoredFile(parts[0], parts[1], parts[2]);
        if (absolute) fs.rmSync(absolute, { force: true });
    }
};

/** True for the `<role>/<userId>/<file>` paths this module stores. */
export const isStoredFileReference = (reference: unknown): boolean => {
    if (typeof reference !== "string") return false;
    const parts = reference.split("/");
    return (
        parts.length === 3 &&
        isStorageRole(parts[0]) &&
        /^[a-f0-9]{24}$/i.test(parts[1]) &&
        SAFE_NAME.test(parts[2])
    );
};

/** Absolute path for a stored file, or null when anything about it is unsafe. */
export const resolveStoredFile = (role: string, userId: string, fileName: string): string | null => {
    if (!isStorageRole(role)) return null;
    if (!/^[a-f0-9]{24}$/i.test(userId)) return null;
    if (!SAFE_NAME.test(fileName)) return null;

    const root = path.resolve(env.uploadsDir, role, userId) + path.sep;
    const absolute = path.resolve(root, fileName);
    return absolute.startsWith(root) ? absolute : null;
};
