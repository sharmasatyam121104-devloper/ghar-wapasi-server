import { ApiError } from "../../../shared/errors/ApiError";
import { env } from "../../../config/env.config";
import type { OtpDelivery, OtpProvider } from "./provider.types";
import { describePurpose } from "./provider.types";

/**
 * DEVELOPMENT ONLY. Prints the code to the server console instead of mailing it.
 *
 * Nothing here reaches a mailbox, so there is no real verification - the code
 * only exists in the process log and, outside production, in the response body.
 * That is exactly why the response field it feeds is gated on `env.isProduction`.
 *
 * To go live, write a class with the same `send` signature that hands the code
 * to your mail transport and delete this one from the registry. No caller, no
 * route and no service changes are needed: the registry picks the provider by
 * channel, and everything above it only sees `OtpProvider`.
 */
export class DummyEmailProvider implements OtpProvider {
    public readonly channel = "email" as const;

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
                "Email delivery is not configured. Contact support to change your email address.",
            );
        }

        const minutes = Math.round((delivery.expiresAt.getTime() - Date.now()) / 60000);

        console.warn(
            `[otp] DEV-ONLY email code for user ${delivery.userId} ` +
                `(${describePurpose(delivery.purpose)}): ${delivery.code} ` +
                `- expires in ${minutes} min, ${delivery.attemptsAllowed} attempts`,
        );
    }
}
