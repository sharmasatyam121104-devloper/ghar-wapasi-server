const read = (name: string, fallback: string): string => {
    const value = process.env[name];
    return value && value.trim() ? value : fallback;
};

export const env = {
    nodeEnv: read("NODE_ENV", "development"),
    port: Number(read("PORT", "8080")),
    clientUrl: read("CLIENT_URL", "http://localhost:5173"),
    isProduction: read("NODE_ENV", "development") === "production",
} as const;
