export function createCorsOriginPolicy({ nodeEnv, configuredOrigins }) {
  const allowedOrigins = String(configuredOrigins || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (nodeEnv === "production") {
    if (!allowedOrigins.length) {
      throw new Error("CORS_ORIGIN must list trusted HTTPS frontend origins in production.");
    }
    for (const origin of allowedOrigins) {
      let parsed;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(`CORS_ORIGIN contains an invalid origin: ${origin}`);
      }
      if (parsed.protocol !== "https:" || parsed.origin !== origin) {
        throw new Error(`CORS_ORIGIN must contain exact HTTPS origins without paths: ${origin}`);
      }
    }
  }

  return (origin) => {
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;
    return nodeEnv !== "production" && allowedOrigins.length === 0;
  };
}
