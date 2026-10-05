import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import { OTP_CHANNELS, OTP_PURPOSES, OTP_STATUSES, type OtpChallengeInterface } from "./otp.types";

export type OtpChallengeDocument = HydratedDocument<OtpChallengeInterface>;

/**
 * One row per code ever issued.
 *
 * Rows are kept rather than deleted so a cooldown and an hourly cap can be
 * counted from real history, and so a replayed receipt has something to be
 * rejected against. `expires_at` carries a TTL index, so Mongo reaps them once
 * they are dead weight - without any cron on our side.
 *
 * Neither `code_hash` nor `receipt_hash` is ever selected by default: a leaked
 * backup with the digests still cannot produce a working code or receipt.
 */
const otpChallengeSchema = new Schema<OtpChallengeInterface>(
    {
        user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
        purpose: {
            type: String,
            required: true,
            enum: {
                values: OTP_PURPOSES,
                message: "{VALUE} is not a supported OTP purpose.",
            },
        },
        channel: {
            type: String,
            required: true,
            enum: {
                values: OTP_CHANNELS,
                message: "{VALUE} is not a supported OTP channel.",
            },
        },
        /** Already normalised: a lowercase email, or bare digits for a number. */
        target: { type: String, required: true, trim: true },

        // bcrypt digest of the code. Cleared once the code stops being useful.
        code_hash: { type: String, default: null, select: false },

        // sha256 of the single-use receipt handed to the client on success.
        receipt_hash: { type: String, default: null, select: false },

        status: {
            type: String,
            enum: {
                values: OTP_STATUSES,
                message: "{VALUE} is not a valid OTP status.",
            },
            default: "pending",
            required: true,
        },
        attempts: { type: Number, default: 0 },
        max_attempts: { type: Number, required: true },

        expires_at: { type: Date, required: true },
        verified_at: { type: Date },
        /** Set when a profile update actually spends the receipt. */
        consumed_at: { type: Date },
        last_sent_at: { type: Date, required: true, default: Date.now },
    },
    {
        timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
        toJSON: {
            virtuals: true,
            transform: (_doc, ret: Record<string, unknown>) => {
                ret.id = ret._id;
                delete ret._id;
                delete ret.__v;
                delete ret.code_hash;
                delete ret.receipt_hash;
                return ret;
            },
        },
        toObject: { virtuals: true },
    },
);

/** Serves the "give me a new code" path: newest challenge for a user + purpose. */
otpChallengeSchema.index({ user_id: 1, purpose: 1, created_at: -1 });

/**
 * The receipt lookup, and the one place a digest can be searched by exact value.
 * Unique because a receipt is random; the odds of two colliding are nil, and a
 * collision must not silently merge two users' receipts.
 *
 * `partialFilterExpression`, not `sparse`: every new challenge carries
 * `receipt_hash: null` until a code is confirmed, and a sparse index skips only
 * *missing* fields - it still indexes an explicit `null`. So a sparse unique
 * index here makes the second OTP request ever issued fail with E11000 on
 * `receipt_hash: null`. The partial filter indexes only the rows that actually
 * hold a digest, which is what the lookup needs.
 *
 * Deploying this over an existing collection: the previous `receipt_hash_1`
 * index has to be dropped once, or it keeps rejecting the `null` values.
 * `db.collection("otpchallenges").dropIndex("receipt_hash_1")`.
 */
otpChallengeSchema.index(
    { receipt_hash: 1 },
    {
        unique: true,
        partialFilterExpression: { receipt_hash: { $type: "string" } },
    },
);

/** Mongo deletes the row once it is past its life. Nothing else depends on it. */
otpChallengeSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const OtpChallenge: Model<OtpChallengeInterface> = model<OtpChallengeInterface>(
    "OtpChallenge",
    otpChallengeSchema,
);