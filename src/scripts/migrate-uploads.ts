// One-off: move registrations that stored their documents inline as base64 data
// URLs onto disk, so the file API can serve them like everything else.
//
//   npx tsx src/scripts/migrate-uploads.ts
//
// Idempotent: entries that are already a path (or a seeded placeholder URL) are
// left exactly as they are, so it is safe to run again.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { connectDatabase } from "../config/db.config";
import { env } from "../config/env.config";
import { ensureUploadDirectories } from "../features/files/file.storage";
import { User } from "../features/users/users.model";

const DATA_URL = /^data:(image\/(?:jpeg|jpg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/;

const EXTENSION: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
};

/** Writes one data URL to the member's folder; returns the stored path or null. */
const storeDataUrl = (value: unknown, role: string, userId: string, stem: string): string | null => {
    if (typeof value !== "string") return null;
    const match = DATA_URL.exec(value);
    if (!match) return null;

    const extension = EXTENSION[match[1]];
    if (!extension) return null;

    const directory = path.join(env.uploadsDir, role, userId);
    fs.mkdirSync(directory, { recursive: true });
    const name = `${stem}.${extension}`;
    fs.writeFileSync(path.join(directory, name), Buffer.from(match[2], "base64"));
    return `${role}/${userId}/${name}`;
};

const migrateList = (
    list: string[] | undefined,
    role: string,
    userId: string,
    stem: string,
    onChanged: () => void,
): string[] | undefined => {
    if (!list?.length) return list;
    return list.map((entry, index) => {
        const stored = storeDataUrl(entry, role, userId, `${stem}-${index + 1}`);
        if (stored) onChanged();
        return stored ?? entry;
    });
};

const migrate = async (): Promise<void> => {
    ensureUploadDirectories();

    const connected = await connectDatabase();
    if (!connected) {
        console.error("[migrate] could not reach the database - nothing changed.");
        process.exitCode = 1;
        return;
    }

    const members = await User.find({ role: { $in: ["police", "ngo"] } });
    let usersChanged = 0;
    let filesWritten = 0;

    for (const user of members) {
        const userId = String(user._id);
        let touched = false;

        if (user.role === "police" && user.police) {
            user.police.id_card_files = migrateList(
                user.police.id_card_files,
                "police",
                userId,
                "id-card",
                () => {
                    touched = true;
                    filesWritten += 1;
                },
            );
            user.police.appointment_proof_files = migrateList(
                user.police.appointment_proof_files,
                "police",
                userId,
                "appointment-proof",
                () => {
                    touched = true;
                    filesWritten += 1;
                },
            );
            if (touched) user.markModified("police");
        }

        if (user.role === "ngo" && user.ngo) {
            user.ngo.reg_certificate_files = migrateList(
                user.ngo.reg_certificate_files,
                "ngo",
                userId,
                "reg-certificate",
                () => {
                    touched = true;
                    filesWritten += 1;
                },
            );
            user.ngo.org_photo_files = migrateList(user.ngo.org_photo_files, "ngo", userId, "org-photo", () => {
                touched = true;
                filesWritten += 1;
            });
            if (touched) user.markModified("ngo");
        }

        if (touched) {
            await user.save();
            usersChanged += 1;
        }
    }

    console.log(`[migrate] ${usersChanged} user(s) updated, ${filesWritten} file(s) written to ${env.uploadsDir}`);
};

migrate()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
        console.error("[migrate] failed:", error);
        process.exit(1);
    });
