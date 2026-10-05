import { ApiError } from "../../../shared/errors/ApiError";
import { env } from "../../../config/env.config";
import type { OtpDelivery, OtpProvider } from "./provider.types";
import { describePurpose } from "./provider.types";

/**
 * DEVELOPMENT ONLY. Prints the code to the server console instead of texting it.
 *
 * The mobile counterpart of `DummyEmailProvider` - same contract, same
 * development-only caveat, same rule that the code must stop appearing in
 * production logs. Swap in an MSG91 / Twilio / SES implementation that keeps the
 * `send` signature and nothing upstream has to change.
 */
export class DummySmsProvider implements OtpProvider {
    public readonly channel = "mobile" as const;

    /** Only a placeholder outside production - there is nowhere for it to send. */
    public isConfigured(): boolean {
        return !env.isProduction;
    }

    public async send(delivery: OtpDelivery): Promise<void> {
        // Checked before anything is written anywhere. The refusal has to come
        // first: logging the code and *then* complaining about logging the code
        // still puts it in the log, which is the thing we are avoiding.
        if (env.isProduction) {
            throw ApiError.serviceUnavailable(
                "Text delivery is not configured. Contact support to change your mobile number.",
            );
        }

        const minutes = Math.round((delivery.expiresAt.getTime() - Date.now()) / 60000);

        console.warn(
            `[otp] DEV-ONLY sms code for user ${delivery.userId} ` +
                `(${describePurpose(delivery.purpose)}): ${delivery.code} ` +
                `- expires in ${minutes} min, ${delivery.attemptsAllowed} attempts`,
        );
    }
}
