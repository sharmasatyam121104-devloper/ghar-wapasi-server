import type { OtpChannel, OtpPurpose } from "../otp.types";

/** Everything a provider needs to deliver one code. */
export interface OtpDelivery {
    userId: string;
    channel: OtpChannel;
    /** Normalised destination - an email or bare digits. */
    target: string;
    /** The plain code. It exists here and nowhere else after this call. */
    code: string;
    purpose: OtpPurpose;
    expiresAt: Date;
    /** How many attempts the caller gets, so the message can be accurate. */
    attemptsAllowed: number;
}

/**
 * The contract every delivery channel implements.
 *
 * A provider is handed the plain code and is responsible for getting it to the
 * user. It must never return the code, and must never log it once a real
 * transport is wired in - see the dummy implementations below for the shape.
 */
export interface OtpProvider {
    readonly channel: OtpChannel;
    /**
     * Whether this provider can actually deliver right now.
     *
     * Called before anything is written, so a channel with no transport wired up
     * fails the request outright instead of leaving a live challenge the user
     * can never receive the code for - which would quietly eat one of their
     * hourly slots every time they tried.
     */
    isConfigured(): boolean;
    send(delivery: OtpDelivery): Promise<void>;
}

/** Reads well in the provider implementations and keeps the messages consistent. */
export const describePurpose = (purpose: OtpPurpose): string =>
    purpose === "PROFILE_EMAIL_CHANGE"
        ? "confirm your new email address"
        : "confirm your new mobile number";