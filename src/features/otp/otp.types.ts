import type { Types } from "mongoose";

/**
 * Every reason the OTP module may be asked for a code.
 *
 * The purpose is part of the stored challenge and of the receipt the caller gets
 * back, so a code issued for one thing can never be spent on another. Adding a
 * new flow means adding a value here - never a new code path in the service.
 */
export const OTP_PURPOSES = ["PROFILE_EMAIL_CHANGE", "PROFILE_MOBILE_CHANGE"] as const;

export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/** How the code is delivered. Kept separate from purpose so a future purpose can reuse either. */
export const OTP_CHANNELS = ["email", "mobile"] as const;

export type OtpChannel = (typeof OTP_CHANNELS)[number];

/** The channel a purpose is locked to. Purpose + channel can never disagree. */
export const OTP_CHANNEL_BY_PURPOSE: Record<OtpPurpose, OtpChannel> = {
    PROFILE_EMAIL_CHANGE: "email",
    PROFILE_MOBILE_CHANGE: "mobile",
};

/** What the purpose means in a sentence the user actually reads. */
export const OTP_PURPOSE_LABEL: Record<OtpPurpose, string> = {
    PROFILE_EMAIL_CHANGE: "changing the email address on your account",
    PROFILE_MOBILE_CHANGE: "changing the mobile number on your account",
};

/**
 * A code is live while it is pending and inside its expiry. `failed` means the
 * attempts ran out; `superseded` means a newer code replaced it. Both are
 * terminal, which is what stops a replay.
 */
export const OTP_STATUSES = ["pending", "verified", "failed", "superseded", "expired"] as const;

export type OtpStatus = (typeof OTP_STATUSES)[number];

export const TERMINAL_OTP_STATUSES: readonly OtpStatus[] = [
    "verified",
    "failed",
    "superseded",
    "expired",
] as const;

export interface OtpChallengeInterface {
    _id: Types.ObjectId;

    user_id: Types.ObjectId;
    purpose: OtpPurpose;
    channel: OtpChannel;

    /** Normalised destination - an email or bare digits, never the raw input. */
    target: string;

    /** bcrypt digest. Never the code itself, and `select: false` like a password. */
    code_hash: string | null;

    /**
     * sha256 of the single-use receipt handed back on success. The receipt is
     * what a profile update consumes, so leaking the challenge id is not enough
     * to change someone's email.
     */
    receipt_hash: string | null;

    status: OtpStatus;
    attempts: number;
    max_attempts: number;

    expires_at: Date;
    verified_at?: Date;
    consumed_at?: Date;
    last_sent_at: Date;

    created_at: Date;
    updated_at: Date;
}

/** What `POST /api/otp/request` returns. */
export interface OtpRequestResult {
    challenge_id: string;
    purpose: OtpPurpose;
    channel: OtpChannel;
    /** Never the full address or number - the client already knows what it sent. */
    target_masked: string;
    expires_at: string;
    expires_in_seconds: number;
    resend_after_seconds: number;
    attempts_allowed: number;
    /**
     * Development only. `otp.service` omits this entirely when NODE_ENV is
     * production, so no response shape can leak it by accident.
     */
    dev_code?: string;
}

/** What `POST /api/otp/verify` returns - the receipt plus what it may be spent on. */
export interface OtpVerificationResult {
    /** Single use. Pass it back as `otp_token` on the profile update. */
    otp_token: string;
    challenge_id: string;
    purpose: OtpPurpose;
    channel: OtpChannel;
    target: string;
    verified_at: string;
    expires_in_seconds: number;
    /**
     * Police and NGO change their contact details *and* wait for an admin. This
     * flag is the client-facing half of that, so the UI can say "your OTP is
     * done, an admin still has to approve" instead of implying it is finished.
     */
    admin_approval_required: boolean;
}

export interface OtpRequestInput {
    purpose: unknown;
    channel?: unknown;
    target: unknown;
}

export interface OtpVerifyInput {
    challenge_id: unknown;
    code: unknown;
}

/**
 * Narrows an untrusted body value to a real purpose. Returns undefined rather
 * than throwing so the controller can build a readable field error.
 */
export const parseOtpPurpose = (value: unknown): OtpPurpose | undefined => {
    if (typeof value !== "string") return undefined;
    const purpose = value.trim().toUpperCase() as OtpPurpose;
    return OTP_PURPOSES.includes(purpose) ? purpose : undefined;
};

/** Same narrowing for the channel. */
export const parseOtpChannel = (value: unknown): OtpChannel | undefined => {
    if (typeof value !== "string") return undefined;
    const channel = value.trim().toLowerCase() as OtpChannel;
    return OTP_CHANNELS.includes(channel) ? channel : undefined;
};

/** Hides all but the last two characters of the destination. */
export const maskOtpTarget = (channel: OtpChannel, target: string): string => {
    if (channel === "email") {
        const [name = "", domain = ""] = target.split("@");
        const head = name.slice(0, 2);
        return `${head}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
    }
    return `${"*".repeat(Math.max(0, target.length - 2))}${target.slice(-2)}`;
};