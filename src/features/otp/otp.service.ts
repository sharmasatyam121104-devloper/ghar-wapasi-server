import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { env } from "../../config/env.config";
import { ApiError, type ErrorDetail } from "../../shared/errors/ApiError";
import { isEmail, isMobile, normalizeEmail, stripNonDigits } from "../../shared/validators/validators";
import { isPoliceOrNgo } from "../../shared/types/roles";
import type { UserDocument } from "../users/users.model";
import { User } from "../users/users.model";
import { OtpChallenge } from "./otp.model";
import * as repo from "./otp.repository";
import { assertProviderReady } from "./providers";
import {
    maskOtpTarget,
    OTP_CHANNEL_BY_PURPOSE,
    OTP_PURPOSE_LABEL,
    parseOtpChannel,
    parseOtpPurpose,
    type OtpChannel,
    type OtpPurpose,
    type OtpRequestResult,
    type OtpVerificationResult,
} from "./otp.types";

/**
 * The centralized OTP module. One implementation for every future purpose -
 * adding a flow means adding a value to `OTP_PURPOSES`, not a second set of
 * rules.
 *
 * This module is deliberately unaware of profiles. It knows how to prove someone
 * controls a destination and how to hand back a single-use receipt; deciding what
 * a proven contact is allowed to change, and whether an admin has to look at it,
 * belongs to the feature that owns the change.
 */

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

/** Six digits is what a person can retype from a phone screen. */
const OTP_LENGTH = 6;

/**
 * Ten minutes by default. Long enough to find the message, short enough that a
 * code left in an old SMS is worthless.
 */
const OTP_TTL_MS = env.otpTtlSeconds * 1000;

/**
 * Five tries by default. A six digit code is about 20 bits of entropy, so the
 * attempts cap is what actually makes guessing impractical - the window is
 * short, but the cap is the real limit.
 */
const OTP_MAX_ATTEMPTS = env.otpMaxAttempts;

/**
 * No second code within a minute by default, so one target cannot be used to
 * flood someone. Zero disables the wait, which the test suite relies on.
 */
const RESEND_COOLDOWN_MS = Math.max(0, env.otpResendCooldownSeconds) * 1000;

/** And no more than this many codes per hour per purpose, whatever the cooldown says. */
const MAX_PER_HOUR = env.otpMaxPerHour;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Fewer rounds than the password's twelve: a code is six characters and the
 * challenge is short lived, so the cost of a slow hash buys very little here.
 * Still a KDF rather than a plain digest - a database leak must not make a
 * stored code instantly enumerable.
 */
const OTP_HASH_ROUNDS = 10;

/* ------------------------------------------------------------------ */
/* Generation and hashing                                              */
/* ------------------------------------------------------------------ */

/**
 * `randomInt` rather than arithmetic on `randomBytes`, which would bias the
 * low digits. Zero padded so `000042` and `42` are the same six characters.
 */
export const generateOtpCode = (): string =>
    crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");

export const hashOtpCode = (code: string): Promise<string> => bcrypt.hash(code, OTP_HASH_ROUNDS);

/**
 * A receipt is high entropy random data, not a user-chosen secret, so a fast
 * deterministic digest is right here - the same reasoning as `hashRefreshToken`.
 */
export const hashReceipt = (receipt: string): string =>
    crypto.createHash("sha256").update(receipt).digest("hex");

const issueReceipt = (): { plain: string; hash: string } => {
    const plain = crypto.randomBytes(32).toString("hex");
    return { plain, hash: hashReceipt(plain) };
};

/* ------------------------------------------------------------------ */
/* Target validation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Checks that the destination is well formed, not already this user's, and not
 * already somebody else's. The last two are re-checked when an admin approves,
 * because the answer can change while the request sits in the queue.
 */
const assertTargetUsable = async (
    user: UserDocument,
    purpose: OtpPurpose,
    channel: OtpChannel,
    target: string,
    errors: ErrorDetail,
): Promise<void> => {
    if (target === (channel === "email" ? user.email : user.mobile)) {
        errors.target =
            channel === "email"
                ? "That is already the email address on your account."
                : "That is already the mobile number on your account.";
        return;
    }

    const filter = channel === "email" ? { email: target } : { mobile: target };
    const taken = await User.findOne({ ...filter, _id: { $ne: user._id } })
        .select("_id")
        .lean();

    if (taken) {
        errors.target =
            channel === "email"
                ? "An account with this email address already exists."
                : "An account with this mobile number already exists.";
    }
};

interface ResolvedTarget {
    purpose: OtpPurpose;
    channel: OtpChannel;
    target: string;
}

/**
 * Validates the purpose, the optional channel and the destination together, so a
 * body claiming `PROFILE_MOBILE_CHANGE` with an email target cannot slip through.
 */
const resolveTarget = (user: UserDocument, body: Record<string, unknown>): ResolvedTarget => {
    const errors: ErrorDetail = {};

    const purpose = parseOtpPurpose(body.purpose);
    if (!purpose) {
        errors.purpose = "Tell us what the code is for: PROFILE_EMAIL_CHANGE or PROFILE_MOBILE_CHANGE.";
        throw ApiError.unprocessable("Please fix the highlighted details.", errors);
    }

    const expectedChannel = OTP_CHANNEL_BY_PURPOSE[purpose];

    // The channel is optional, but if the client sends one it has to be the one
    // that purpose implies - otherwise the code and the change would disagree.
    let channel = expectedChannel;
    if (body.channel !== undefined) {
        const parsed = parseOtpChannel(body.channel);
        if (!parsed) {
            errors.channel = "The channel has to be either email or mobile.";
        } else if (parsed !== expectedChannel) {
            errors.channel = `${purpose} is always sent over ${expectedChannel}.`;
        } else {
            channel = parsed;
        }
    }

    const raw = typeof body.target === "string" ? body.target.trim() : "";
    if (!raw) {
        errors.target =
            expectedChannel === "email"
                ? "Enter the new email address you want to use."
                : "Enter the new mobile number you want to use.";
    }

    let target = "";
    if (raw) {
        if (expectedChannel === "email") {
            target = normalizeEmail(raw);
            if (!isEmail(target)) errors.target = "Enter a valid email address.";
        } else {
            target = stripNonDigits(raw);
            if (!isMobile(target)) errors.target = "Enter a valid 10-digit mobile number.";
        }
    }

    if (Object.keys(errors).length > 0) {
        throw ApiError.unprocessable("Please fix the highlighted details.", errors);
    }

    return { purpose, channel, target };
};

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

/**
 * Issues a code for a destination. Any live code for the same purpose is
 * superseded first, so asking twice can never leave two working codes behind.
 */
export const requestOtp = async (
    user: UserDocument,
    body: Record<string, unknown>,
): Promise<OtpRequestResult> => {
    const { purpose, channel, target } = resolveTarget(user, body);
    const userId = user._id as Types.ObjectId;

    const errors: ErrorDetail = {};
    await assertTargetUsable(user, purpose, channel, target, errors);
    if (Object.keys(errors).length > 0) {
        throw ApiError.unprocessable("Please fix the highlighted details.", errors);
    }

    const latest = await repo.findLatestForPurpose(userId, purpose);
    if (latest) {
        const sinceLastSend = Date.now() - new Date(latest.last_sent_at).getTime();
        if (latest.status === "pending" && sinceLastSend < RESEND_COOLDOWN_MS) {
            const wait = Math.ceil((RESEND_COOLDOWN_MS - sinceLastSend) / 1000);
            throw ApiError.tooManyRequests(
                `Please wait ${wait} seconds before asking for another code.`,
            );
        }
    }

    const sentThisHour = await repo.countIssuedSince(userId, purpose, new Date(Date.now() - HOUR_MS));
    if (sentThisHour >= MAX_PER_HOUR) {
        throw ApiError.tooManyRequests(
            `You have asked for too many codes. Please try again in an hour.`,
        );
    }

    // Replace rather than keep: the newest request is the only live one.
    await repo.supersedeLive(userId, purpose);

    // Fail before writing anything if this channel has no transport. A live
    // challenge nobody can receive the code for is worse than no challenge: it
    // sits in the cooldown, counts against the hourly cap, and cannot be used.
    const provider = assertProviderReady(channel);

    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const challenge = await OtpChallenge.create({
        user_id: userId,
        purpose,
        channel,
        target,
        code_hash: await hashOtpCode(code),
        status: "pending",
        attempts: 0,
        max_attempts: OTP_MAX_ATTEMPTS,
        expires_at: expiresAt,
        last_sent_at: new Date(),
    });

    try {
        // The provider gets the plain code; the database never will again.
        await provider.send({
            userId: String(userId),
            channel,
            target,
            code,
            purpose,
            expiresAt,
            attemptsAllowed: OTP_MAX_ATTEMPTS,
        });
    } catch (error) {
        // The row exists but no code is going anywhere. Marking it failed keeps it
        // out of the live set, so it can never be verified and never blocks a
        // later, working request.
        await repo.burn(challenge, "failed");
        throw error;
    }

    const result: OtpRequestResult = {
        challenge_id: String(challenge._id),
        purpose,
        channel,
        target_masked: maskOtpTarget(channel, target),
        expires_at: expiresAt.toISOString(),
        expires_in_seconds: Math.round(OTP_TTL_MS / 1000),
        resend_after_seconds: Math.round(RESEND_COOLDOWN_MS / 1000),
        attempts_allowed: OTP_MAX_ATTEMPTS,
    };

    // Development affordance. Gated here rather than at the call site so no other
    // route can produce a response that carries the field.
    if (!env.isProduction) {
        result.dev_code = code;
    }

    return result;
};

/* ------------------------------------------------------------------ */
/* Verify                                                              */
/* ------------------------------------------------------------------ */

/**
 * Checks a code and, on success, returns a single-use receipt. The code itself is
 * destroyed here - it cannot be checked a second time, and the receipt cannot be
 * spent twice.
 */
export const verifyOtp = async (
    user: UserDocument,
    body: Record<string, unknown>,
): Promise<OtpVerificationResult> => {
    const errors: ErrorDetail = {};

    const challengeId = typeof body.challenge_id === "string" ? body.challenge_id.trim() : "";
    if (!challengeId) errors.challenge_id = "Which code are you confirming?";

    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) errors.code = "Enter the code you received.";

    if (Object.keys(errors).length > 0) {
        throw ApiError.unprocessable("Please fix the highlighted details.", errors);
    }

    const challenge = await repo.findOwnedById(challengeId, user._id as Types.ObjectId);
    if (!challenge) {
        // Deliberately vague: this is also the answer for someone else's code.
        throw ApiError.notFound("That code request could not be found.");
    }

    if (repo.isTerminal(challenge.status)) {
        throw ApiError.unprocessable(
            challenge.status === "verified"
                ? "That code has already been used. Ask for a new one."
                : "That code is no longer valid. Ask for a new one.",
        );
    }

    if (challenge.expires_at.getTime() <= Date.now()) {
        await repo.burn(challenge, "expired");
        throw ApiError.unprocessable("That code has expired. Ask for a new one.");
    }

    if (challenge.attempts >= challenge.max_attempts) {
        await repo.burn(challenge, "failed");
        throw ApiError.tooManyRequests("Too many wrong attempts. Ask for a new code.");
    }

    const withHash = await repo.withCodeHash(challenge);
    if (!withHash?.code_hash) {
        // The digest is gone because a concurrent request verified or burned
        // this challenge a moment ago. Nothing to compare against and nothing to
        // mark: `burn` leaves an already-terminal status alone, so the request
        // that actually verified this keeps its receipt.
        const current = await repo.findOwnedById(challengeId, user._id as Types.ObjectId);
        if (current && repo.isTerminal(current.status)) {
            throw ApiError.unprocessable(
                current.status === "verified"
                    ? "That code has already been used. Ask for a new one."
                    : "That code is no longer valid. Ask for a new one.",
            );
        }
        await repo.burn(challenge, "failed");
        throw ApiError.unprocessable("That code is no longer valid. Ask for a new one.");
    }

    const matches = await bcrypt.compare(code, withHash.code_hash);

    if (!matches) {
        // Atomic: the cap is enforced by the database, not by a counter that two
        // concurrent guesses could each read as one-below-the-limit.
        const after = await repo.recordFailedAttempt(
            challenge._id as Types.ObjectId,
            challenge.max_attempts,
        );

        if (!after) {
            // Already at the cap before this guess even counted.
            await repo.burn(challenge, "failed");
            throw ApiError.tooManyRequests("Too many wrong attempts. Ask for a new code.");
        }

        if (after.attempts >= after.max_attempts) {
            // Out of tries: burn the code now so the next guess starts from a
            // fresh request instead of walking into the same wall.
            await repo.burn(challenge, "failed");
            throw ApiError.tooManyRequests("Too many wrong attempts. Ask for a new code.");
        }

        const left = after.max_attempts - after.attempts;
        throw ApiError.unprocessable("That code is not correct.", {
            code: `That code is not correct. ${left} attempt${left === 1 ? "" : "s"} left.`,
        });
    }

    const receipt = issueReceipt();
    const verifiedAt = new Date();

    // Atomic, so two requests replaying the same correct code cannot both walk
    // away with a receipt. The loser is told the code is spent.
    const claimed = await repo.claimForVerification(
        challenge._id as Types.ObjectId,
        receipt.hash,
        verifiedAt,
    );
    if (!claimed) {
        throw ApiError.unprocessable("That code has already been used. Ask for a new one.");
    }

    return {
        otp_token: receipt.plain,
        challenge_id: String(claimed._id),
        purpose: claimed.purpose,
        channel: claimed.channel,
        target: claimed.target,
        verified_at: verifiedAt.toISOString(),
        expires_in_seconds: Math.max(
            0,
            Math.round((claimed.expires_at.getTime() - Date.now()) / 1000),
        ),
        // Police and NGO still wait for an admin after this. The receipt only
        // proves they control the new contact.
        admin_approval_required: isPoliceOrNgo(user.role),
    };
};

/* ------------------------------------------------------------------ */
/* Receipt consumption - used by the profile flows                     */
/* ------------------------------------------------------------------ */

export interface ConsumedReceipt {
    purpose: OtpPurpose;
    channel: OtpChannel;
    /** The destination the code actually proved, not whatever the caller claimed. */
    target: string;
    verified_at: Date;
}

/**
 * Validates a receipt against the change it is meant to authorise, and burns it.
 *
 * This is the answer to "do not trust a client-sent verified flag". A request
 * carrying `otp_token` proves nothing by itself: the digest has to match a
 * challenge that belongs to this caller, is still unconsumed, has not expired,
 * was issued for this exact purpose, and was sent to this exact destination. A
 * receipt for the email change cannot pay for a mobile change, and the same
 * receipt cannot be spent twice.
 */
export const consumeReceipt = async (
    user: UserDocument,
    receipt: unknown,
    expected: { purpose: OtpPurpose; target: string },
): Promise<ConsumedReceipt> => {
    const token = typeof receipt === "string" ? receipt.trim() : "";
    if (!token) {
        throw ApiError.unprocessable(
            `Confirm ${OTP_PURPOSE_LABEL[expected.purpose]} with a code first.`,
            { otp_token: "Verify the new contact with a code, then send the otp_token you got back." },
        );
    }

    const challenge = await repo.findByReceiptHash(hashReceipt(token));
    if (!challenge || String(challenge.user_id) !== String(user._id)) {
        throw ApiError.unprocessable("That code confirmation is not valid.", {
            otp_token: "Verify the new contact with a code, then send the otp_token you got back.",
        });
    }

    if (challenge.consumed_at) {
        throw ApiError.unprocessable("That code has already been used for a change.", {
            otp_token: "Ask for a new code and confirm again.",
        });
    }

    if (challenge.status !== "verified" || !challenge.verified_at) {
        throw ApiError.unprocessable("That code confirmation is not valid.", {
            otp_token: "Verify the new contact with a code, then send the otp_token you got back.",
        });
    }

    if (challenge.expires_at.getTime() <= Date.now()) {
        throw ApiError.unprocessable("That code has expired. Ask for a new one.", {
            otp_token: "Ask for a new code and confirm again.",
        });
    }

    if (challenge.purpose !== expected.purpose) {
        throw ApiError.unprocessable("That code was issued for a different change.", {
            otp_token: `This code proves ${OTP_PURPOSE_LABEL[challenge.purpose]}, not this one.`,
        });
    }

    // The decisive check. Even a genuine, unconsumed, unexpired receipt is void if
    // the request now names a different destination than the one that was proven.
    if (challenge.target !== expected.target) {
        throw ApiError.unprocessable("That code was sent to a different contact.", {
            otp_token: "The code you confirmed was for a different contact. Confirm the new one.",
        });
    }

    // The spend itself. Every condition above is repeated in the filter, because
    // between reading this row and writing to it another request may have spent
    // the same receipt. `consumed_at: null` in the filter is what turns a replay
    // from "probably rejected" into "rejected".
    const claimed = await repo.claimReceipt(hashReceipt(token), {
        userId: user._id as Types.ObjectId,
        purpose: expected.purpose,
        target: expected.target,
    });

    if (!claimed) {
        throw ApiError.unprocessable("That code has already been used for a change.", {
            otp_token: "Ask for a new code and confirm again.",
        });
    }

    return {
        purpose: claimed.purpose,
        channel: claimed.channel,
        target: claimed.target,
        verified_at: claimed.verified_at as Date,
    };
};

/**
 * Re-checks availability before a staff change is promoted, because another
 * account can claim the contact while the request waits in the review queue.
 */
export const assertContactStillFree = async (
    user: UserDocument,
    contact: { email?: string; mobile?: string },
): Promise<void> => {
    const errors: ErrorDetail = {};

    if (contact.email) {
        const taken = await User.findOne({ email: contact.email, _id: { $ne: user._id } })
            .select("_id")
            .lean();
        if (taken) errors.email = "An account with this email address already exists.";
    }

    if (contact.mobile) {
        const taken = await User.findOne({ mobile: contact.mobile, _id: { $ne: user._id } })
            .select("_id")
            .lean();
        if (taken) errors.mobile = "An account with this mobile number already exists.";
    }

    if (Object.keys(errors).length > 0) {
        throw ApiError.conflict("An account with these details already exists.", errors);
    }
};