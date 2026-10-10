import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { createApp } from "../src/http/app.js";
import { createLogger } from "../src/logger.js";
import { createWorker } from "../src/jobs/worker.js";
import { createPlatform } from "../src/fake-platform/server.js";
import { signBody } from "../src/services/webhookService.js";

export const SECRETS = { tokenEncKey: "ab".repeat(32), webhookSecret: "whsec-test", oauthClientSecret: "client-secret-test" };

const listen = (app) => new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });

export async function harness({ platform = {}, cfg = {}, hooks, dir } = {}) {
  const tmp = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "studio-"));
  const plat = createPlatform({ clientSecret: SECRETS.oauthClientSecret, webhookSecret: SECRETS.webhookSecret, deliveryDelayMs: 40, ...platform });
  const platSrv = await listen(plat);
  const platformUrl = `http://127.0.0.1:${platSrv.address().port}`;
  const logs = [];
  const config = loadConfig({ ...SECRETS, platformUrl, dbPath: path.join(tmp, "db.sqlite"), mediaDir: path.join(tmp, "media"), requestTimeoutMs: 800, ...cfg });
  const ctx = createContext(config, { logger: createLogger("test", (l) => logs.push(l)), hooks });
  const app = createApp(ctx);
  const apiSrv = await listen(app);
  const base = `http://127.0.0.1:${apiSrv.address().port}`;
  plat.options.webhookUrl = `${base}/webhook/social-delivery`;
  await ctx.accountService.connect("instagram");
  await ctx.accountService.connect("x");
  const worker = createWorker(ctx);
  const api = async (p, { method = "GET", body, headers = {} } = {}) => {
    const r = await fetch(base + p, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json, headers: r.headers };
  };
  return {
    ctx, plat, base, platformUrl, worker, api, logs, tmp,
    advance: (s) => ctx.clock.advance(s),
    entries: (cid) => ctx.repos.entries.byCampaign(cid),
    async newCampaign(extra = {}) {
      const r = await api("/campaigns", { method: "POST", body: { name: "Studio Launch", summary: "Our new design studio opens its doors with free workshops.", ...extra } });
      if (r.status !== 201) throw new Error("campaign create failed " + JSON.stringify(r.json));
      return r.json;
    },
    postWebhook(body, { signature, secret = SECRETS.webhookSecret } = {}) {
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      const headers = { "content-type": "application/json" };
      const sig = signature === undefined ? signBody(secret, raw) : signature;
      if (sig !== null) headers["x-signature"] = sig;
      return fetch(`${base}/webhook/social-delivery`, { method: "POST", headers, body: raw }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
    },
    async close() { worker.stop(); apiSrv.close(); platSrv.close(); plat.close(); ctx.db.close(); },
  };
}

export async function until(fn, ms = 4000, step = 25) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("until: timed out");
    await new Promise((r) => setTimeout(r, step));
  }
}
