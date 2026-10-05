const read = (name: string, fallback: string): string => {
    const value = process.env[name];
    return value && value.trim() ? value : fallback;
};

export const env = {
    nodeEnv: read("NODE_ENV", "development"),
    port: Number(read("PORT", "8080")),
    clientUrl: read("CLIENT_URL", "http://localhost:5173"),
    dbUrl: read("DB_URL", ""),
    dbName: read("DB_NAME", ""),
    /**
     * OTP policy. Overridable so the limits can be tuned without a code change
     * and so a test run can shorten the resend cooldown instead of sleeping a
     * minute for it. A zero or negative cooldown is treated as "no cooldown".
     */
    otpTtlSeconds: Number(read("OTP_TTL_SECONDS", "600")),
    otpResendCooldownSeconds: Number(read("OTP_RESEND_COOLDOWN_SECONDS", "60")),
    otpMaxAttempts: Number(read("OTP_MAX_ATTEMPTS", "5")),
    otpMaxPerHour: Number(read("OTP_MAX_PER_HOUR", "5")),
    isProduction: read("NODE_ENV", "development") === "production",
} as const;
