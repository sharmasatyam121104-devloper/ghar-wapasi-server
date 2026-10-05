import { Types, type QueryFilter } from "mongoose";
import { OtpChallenge, type OtpChallengeDocument } from "./otp.model";
import { TERMINAL_OTP_STATUSES, type OtpChallengeInterface, type OtpPurpose } from "./otp.types";

/**
 * Every read and write of an OTP challenge lives here.
 *
 * The service decides *what* should happen; this file decides *where it is
 * stored*. Keeping the queries in one place means the field-level `select`
 * rules - `code_hash` and `receipt_hash` are never selected unless a digest is
 * genuinely being compared - are impossible to get wrong from a service.
 */

/** The most recent challenge for a user and purpose, whichever state it is in. */
export const findLatestForPurpose = async (
    userId: Types.ObjectId,
    purpose: OtpPurpose,
): Promise<OtpChallengeDocument | null> =>
    OtpChallenge.findOne({ user_id: userId, purpose }).sort({ created_at: -1 });

/**
 * Challenges that are still alive for a user and purpose. Used by the resend
 * guard, which has to supersede a live code before it makes a new one.
 */
export const findLiveForPurpose = async (
    userId: Types.ObjectId,
    purpose: OtpPurpose,
): Promise<OtpChallengeDocument[]> =>
    OtpChallenge.find({
        user_id: userId,
        purpose,
        status: "pending",
        expires_at: { $gt: new Date() },
    });

/** How many codes went out for a user and purpose inside a recent window. */
export const countIssuedSince = async (
    userId: Types.ObjectId,
    purpose: OtpPurpose,
    since: Date,
): Promise<number> =>
    OtpChallenge.countDocuments({
        user_id: userId,
        purpose,
        created_at: { $gte: since },
    });

/** A challenge by id, locked to its owner. A wrong owner is indistinguishable from a wrong id. */
export const findOwnedById = async (
    challengeId: string,
    userId: Types.ObjectId,
): Promise<OtpChallengeDocument | null> => {
    if (!Types.ObjectId.isValid(challengeId)) return null;
    return OtpChallenge.findOne({ _id: challengeId, user_id: userId });
};

/**
 * The receipt lookup. `+receipt_hash` is requested because it is `select: false`
 * - this is the only place a stored digest is read back for comparison.
 */
export const findByReceiptHash = async (receiptHash: string): Promise<OtpChallengeDocument | null> =>
    OtpChallenge.findOne({ receipt_hash: receiptHash }).select("+receipt_hash");

/** `+code_hash` for the bcrypt comparison, and only for that. */
export const withCodeHash = (challenge: OtpChallengeDocument): Promise<OtpChallengeDocument | null> =>
    OtpChallenge.findById(challenge._id).select("+code_hash");

/** Bulk-mark every live challenge for a user + purpose as replaced by a newer one. */
export const supersedeLive = async (
    userId: Types.ObjectId,
    purpose: OtpPurpose,
): Promise<number> => {
    const result = await OtpChallenge.updateMany(
        {
            user_id: userId,
            purpose,
            status: "pending",
            expires_at: { $gt: new Date() },
        } satisfies QueryFilter<OtpChallengeInterface>,
        { $set: { status: "superseded" } },
    );
    return result.modifiedCount;
};

/**
 * Marks a live challenge terminal and drops the code digest, so the secret does
 * not outlive its use.
 *
 * Two deliberate choices here, both about concurrency:
 *
 * - The filter is `status: "pending"`. A terminal status is final, and without
 *   this guard a request that was a few milliseconds too slow could downgrade a
 *   challenge another request had already verified - leaving a receipt that
 *   looks issued but can never be spent, and an account that just proved it
 *   controls its new email.
 * - An `updateOne`, not `save()` on the passed document. That document can be
 *   stale, and saving it would write back an `attempts` count that has since
 *   moved on, quietly handing out extra guesses.
 */
export const burn = async (
    challenge: OtpChallengeDocument,
    status: "verified" | "failed" | "superseded" | "expired",
): Promise<void> => {
    await OtpChallenge.updateOne(
        { _id: challenge._id, status: "pending" },
        { $set: { status, code_hash: null } },
    );
};

/* ------------------------------------------------------------------ */
/* Atomic claims                                                       */
/* ------------------------------------------------------------------ */

/**
 * The single place a code stops being usable.
 *
 * `findOneAndUpdate` with `status: "pending"` in the filter is the whole point:
 * two requests carrying the same correct code, arriving together, cannot both
 * win. The loser matches nothing and is told the code is spent. Read-then-save
 * would let both read `pending` and both succeed.
 */
export const claimForVerification = async (
    challengeId: Types.ObjectId,
    receiptHash: string,
    verifiedAt: Date,
): Promise<OtpChallengeDocument | null> =>
    OtpChallenge.findOneAndUpdate(
        { _id: challengeId, status: "pending", expires_at: { $gt: new Date() } },
        {
            $set: {
                status: "verified",
                code_hash: null,
                receipt_hash: receiptHash,
                verified_at: verifiedAt,
            },
        },
        { returnDocument: "after" },
    );

/**
 * Counts one wrong guess, atomically, and refuses to go past the cap.
 *
 * The `$lt` in the filter is what makes the cap mean anything under
 * concurrency: only one increment can move the count from `max - 1` to `max`,
 * and no increment can start from `max` at all.
 *
 * Returns the document after the increment, or `null` if the cap was already
 * reached.
 */
export const recordFailedAttempt = async (
    challengeId: Types.ObjectId,
    maxAttempts: number,
): Promise<OtpChallengeDocument | null> =>
    OtpChallenge.findOneAndUpdate(
        { _id: challengeId, status: "pending", attempts: { $lt: maxAttempts } },
        { $inc: { attempts: 1 } },
        { returnDocument: "after" },
    );

/**
 * Spends a receipt, atomically.
 *
 * Every condition that makes the receipt spendable is in the filter, so the
 * check and the spend are one operation: `consumed_at: null` is what stops a
 * replayed receipt from being spent twice, even by two requests arriving at the
 * same moment. Clearing `receipt_hash` means a replay finds nothing at all.
 *
 * Returns the consumed challenge, or `null` if some condition no longer holds -
 * the caller has already read the row, so a null here means another request
 * got there first.
 */
export const claimReceipt = async (
    receiptHash: string,
    expected: {
        userId: Types.ObjectId;
        purpose: OtpPurpose;
        target: string;
    },
): Promise<OtpChallengeDocument | null> =>
    OtpChallenge.findOneAndUpdate(
        {
            receipt_hash: receiptHash,
            user_id: expected.userId,
            purpose: expected.purpose,
            target: expected.target,
            status: "verified",
            consumed_at: null,
            expires_at: { $gt: new Date() },
        },
        { $set: { consumed_at: new Date(), receipt_hash: null } },
        { returnDocument: "after" },
    );

/** True once a challenge can no longer be verified against. */
export const isTerminal = (status: OtpChallengeInterface["status"]): boolean =>
    (TERMINAL_OTP_STATUSES as readonly string[]).includes(status);