import { loadConfig } from "../config.js";
import { createPlatform } from "./server.js";

const cfg = loadConfig();
const app = createPlatform({
  clientId: cfg.oauthClientId,
  clientSecret: cfg.oauthClientSecret || "dev-secret",
  webhookSecret: cfg.webhookSecret || "dev-webhook",
  webhookUrl: process.env.WEBHOOK_URL || `http://localhost:${cfg.port}/webhook/social-delivery`,
});
app.listen(cfg.platformPort, () => console.log(JSON.stringify({ msg: "fake platform listening", port: cfg.platformPort })));
