import fs from "node:fs";
import path from "node:path";

// Load .env if present (Node built-in). Real environment variables win.
if (fs.existsSync(".env")) {
  try { process.loadEnvFile(".env"); } catch { /* ignore malformed .env */ }
}

const int = (v, d) => (v === undefined || v === "" ? d : Number.parseInt(v, 10));

export function loadConfig(overrides = {}) {
  const env = process.env;
  const cfg = {
    port: int(env.PORT, 3000),
    platformPort: int(env.PLATFORM_PORT, 4010),
    platformUrl: env.PLATFORM_URL || "http://localhost:4010",
    dbPath: path.resolve(env.DB_PATH || "./data/studio.sqlite"),
    mediaDir: path.resolve(env.MEDIA_DIR || "./data/media"),
    tokenEncKey: env.TOKEN_ENC_KEY || "",
    webhookSecret: env.WEBHOOK_SECRET || "",
    oauthClientId: env.OAUTH_CLIENT_ID || "studio-client",
    oauthClientSecret: env.OAUTH_CLIENT_SECRET || "",
    enableAdmin: env.ENABLE_ADMIN !== "0",
    workerPollMs: int(env.WORKER_POLL_MS, 500),
    leaseSeconds: int(env.LEASE_SECONDS, 30),
    maxAttempts: int(env.MAX_ATTEMPTS, 5),
    backoffBaseSeconds: int(env.BACKOFF_BASE_SECONDS, 2),
    backoffCapSeconds: int(env.BACKOFF_CAP_SECONDS, 300),
    requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS, 5000),
    reconcileAfterSeconds: int(env.RECONCILE_AFTER_SECONDS, 60),
    // Test hook: exit the worker right after the platform accepted a post but
    // before the result was saved (simulates a crash mid-batch).
    crashAfterPlatformCall: env.CRASH_AFTER_PLATFORM_CALL === "1",
    ...overrides,
  };
  return cfg;
}

export function assertSecrets(cfg) {
  const missing = [];
  if (!/^[0-9a-f]{64}$/i.test(cfg.tokenEncKey)) missing.push("TOKEN_ENC_KEY (64 hex chars)");
  if (!cfg.webhookSecret) missing.push("WEBHOOK_SECRET");
  if (!cfg.oauthClientSecret) missing.push("OAUTH_CLIENT_SECRET");
  if (missing.length) {
    throw new Error(`Missing config: ${missing.join(", ")}. Copy .env.example to .env or run \`npm start\` (it creates one).`);
  }
}
