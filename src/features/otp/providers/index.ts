import { ApiError } from "../../../shared/errors/ApiError";
import type { OtpChannel } from "../otp.types";
import { DummyEmailProvider } from "./email.provider";
import type { OtpProvider } from "./provider.types";
import { DummySmsProvider } from "./sms.provider";

/**
 * The one place that knows which provider serves which channel.
 *
 * Adding a real transport is a one-line change here, which is the whole point of
 * the provider split: the service hands over a plain code and never learns how
 * it travelled.
 */
const PROVIDERS: Record<OtpChannel, OtpProvider> = {
    email: new DummyEmailProvider(),
    mobile: new DummySmsProvider(),
};

export const resolveProvider = (channel: OtpChannel): OtpProvider => {
    const provider = PROVIDERS[channel];
    if (!provider) throw ApiError.internal("No OTP provider is configured for that channel.");
    return provider;
};

/**
 * Fails the request before a challenge is written, if the channel has no way to
 * deliver. The message names the contact type rather than the channel, because
 * this is the only thing the user can act on.
 */
export const assertProviderReady = (channel: OtpChannel): OtpProvider => {
    const provider = resolveProvider(channel);
    if (!provider.isConfigured()) {
        throw ApiError.serviceUnavailable(
            channel === "email"
                ? "We cannot email a code right now. Please contact support to change your email address."
                : "We cannot text a code right now. Please contact support to change your mobile number.",
        );
    }
    return provider;
};

export type { OtpProvider };