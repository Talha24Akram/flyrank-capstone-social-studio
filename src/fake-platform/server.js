import crypto from "node:crypto";
import express from "express";
import sharp from "sharp";

// Stand-in for the "provided" fake social platform (see docs/DESIGN.md). Simulates:
// OAuth token issue/refresh with expiry, Idempotency-Key dedup, 429 + Retry-After, dropped responses
// (client timeouts), random failures, and HMAC-signed delivery webhooks. State is in memory.

const SPECS = { instagram: { w: 1080, h: 1080, maxCaption: 2200 }, x: { w: 1600, h: 900, maxCaption: 280 } };
const rid = (p) => p + crypto.randomBytes(12).toString("hex");

export function createPlatform(opts = {}) {
  const o = {
    clientId: "studio-client", clientSecret: "dev-secret", webhookUrl: null, webhookSecret: "dev-webhook",
    tokenTtlSeconds: 3600, deliveryDelayMs: 800, webhookRetries: 3, ...opts,
  };
  const s = {
    faults: { rateLimitNext: 0, retryAfter: 30, failNext: 0, dropNext: 0, randomFailRate: 0, webhookFailRate: 0, webhookDelayMs: null },
    tokens: new Map(),       // access_token -> {platform, expiresAt}
    refresh: new Map(),      // refresh_token -> platform
    posts: new Map(),        // id -> post
    byKey: new Map(),        // `${platform}:${idemKey}` -> post
    webhooksSent: [],
    calls: { publish: 0, rateLimited: 0, dropped: 0, replayed: 0, failed: 0 },
  };
  const timers = new Set();

  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: false }));

  // ---------- OAuth ----------
  app.post("/oauth/token", (req, res) => {
    const b = req.body || {};
    if (b.client_id !== o.clientId || b.client_secret !== o.clientSecret) return res.status(401).json({ error: "invalid_client" });
    let platform;
    if (b.grant_type === "authorization_code") {
      const m = /^demo-(instagram|x)$/.exec(b.code || "");
      if (!m) return res.status(400).json({ error: "invalid_grant" });
      platform = m[1];
    } else if (b.grant_type === "refresh_token") {
      platform = s.refresh.get(b.refresh_token);
      if (!platform) return res.status(400).json({ error: "invalid_grant" });
      s.refresh.delete(b.refresh_token); // rotating refresh tokens
    } else return res.status(400).json({ error: "unsupported_grant_type" });
    const access = "at_" + crypto.randomBytes(18).toString("hex");
    const refresh = "rt_" + crypto.randomBytes(18).toString("hex");
    s.tokens.set(access, { platform, expiresAt: Date.now() + o.tokenTtlSeconds * 1000 });
    s.refresh.set(refresh, platform);
    res.json({ access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: o.tokenTtlSeconds, platform });
  });

  function auth(platform) {
    return (req, res, next) => {
      const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
      const t = m && s.tokens.get(m[1]);
      if (!t || t.platform !== platform || t.expiresAt < Date.now()) return res.status(401).json({ error: "invalid_token" });
      next();
    };
  }

  // ---------- Publish ----------
  async function publish(req, res, platform, caption, imageB64) {
    const key = req.get("idempotency-key");
    if (!key) return res.status(400).json({ error: "idempotency_key_required" });
    s.calls.publish++;
    const existing = s.byKey.get(`${platform}:${key}`);
    if (existing) { // replay: same key -> same post, no new post
      s.calls.replayed++;
      if (s.faults.dropNext > 0) { s.faults.dropNext--; s.calls.dropped++; return req.socket.destroy(); }
      return res.status(200).set("Idempotent-Replayed", "true").json({ id: existing.id, status: existing.status });
    }
    const f = s.faults;
    if (f.rateLimitNext > 0) {
      f.rateLimitNext--; s.calls.rateLimited++;
      return res.status(429).set("Retry-After", String(f.retryAfter)).json({ error: "rate_limited" });
    }
    if (f.failNext > 0) { f.failNext--; s.calls.failed++; return res.status(503).json({ error: "unavailable" }); }
    if (f.randomFailRate > 0 && Math.random() < f.randomFailRate) { s.calls.failed++; return res.status(500).json({ error: "random_failure" }); }

    const spec = SPECS[platform];
    if (typeof caption !== "string" || !caption || caption.length > spec.maxCaption) return res.status(422).json({ error: "bad_caption" });
    let meta;
    try { meta = await sharp(Buffer.from(String(imageB64 || ""), "base64")).metadata(); } catch { return res.status(422).json({ error: "bad_image" }); }
    if (meta.width !== spec.w || meta.height !== spec.h) return res.status(422).json({ error: "bad_image_dimensions", expected: `${spec.w}x${spec.h}`, got: `${meta.width}x${meta.height}` });

    const post = { id: rid("post_"), platform, caption, width: meta.width, height: meta.height, status: "processing", idempotencyKey: key, createdAt: Date.now() };
    s.posts.set(post.id, post);
    s.byKey.set(`${platform}:${key}`, post);
    scheduleDelivery(post);
    if (f.dropNext > 0) { f.dropNext--; s.calls.dropped++; return req.socket.destroy(); } // posted, but client never hears
    res.status(202).json({ id: post.id, status: post.status });
  }
  app.post("/v1/instagram/media", auth("instagram"), (req, res, next) =>
    publish(req, res, "instagram", req.body?.caption, req.body?.image_base64).catch(next));
  app.post("/v1/x/tweets", auth("x"), (req, res, next) =>
    publish(req, res, "x", req.body?.text, req.body?.media_base64).catch(next));

  app.get("/v1/posts/:id", (req, res) => {
    const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
    const t = m && s.tokens.get(m[1]);
    if (!t || t.expiresAt < Date.now()) return res.status(401).json({ error: "invalid_token" });
    const p = s.posts.get(req.params.id);
    if (!p || p.platform !== t.platform) return res.status(404).json({ error: "not_found" });
    res.json({ id: p.id, status: p.status });
  });

  // ---------- Delivery webhooks ----------
  function scheduleDelivery(post) {
    const delay = s.faults.webhookDelayMs ?? o.deliveryDelayMs;
    const t = setTimeout(async () => {
      timers.delete(t);
      post.status = Math.random() < s.faults.webhookFailRate ? "failed" : "published";
      if (!o.webhookUrl) return;
      const body = JSON.stringify({ event_id: rid("evt_"), post_id: post.id, idempotency_key: post.idempotencyKey, platform: post.platform, status: post.status, delivered_at: new Date().toISOString() });
      const sig = "sha256=" + crypto.createHmac("sha256", o.webhookSecret).update(body).digest("hex");
      for (let i = 0; i < o.webhookRetries; i++) {
        try {
          const r = await fetch(o.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-signature": sig }, body });
          s.webhooksSent.push({ post: post.id, status: r.status });
          if (r.ok) return;
        } catch { s.webhooksSent.push({ post: post.id, status: "error" }); }
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }, delay);
    timers.add(t);
  }

  // ---------- Admin (fault injection + inspection) ----------
  app.post("/__admin/faults", (req, res) => { Object.assign(s.faults, req.body || {}); res.json(s.faults); });
  app.get("/__admin/state", (_req, res) => {
    const posts = [...s.posts.values()];
    const count = (p) => posts.filter((x) => x.platform === p).length;
    res.json({ posts: { instagram: count("instagram"), x: count("x"), total: posts.length }, calls: s.calls, faults: s.faults, webhooksSent: s.webhooksSent.length, list: posts });
  });
  app.post("/__admin/reset", (_req, res) => { s.posts.clear(); s.byKey.clear(); s.webhooksSent.length = 0; Object.keys(s.calls).forEach((k) => (s.calls[k] = 0)); res.json({ ok: true }); });
  app.get("/health", (_req, res) => res.json({ ok: true, service: "fake-platform" }));

  app.use((err, _req, res, _next) => { res.status(err.status || 500).json({ error: err.message }); });
  app.close = () => timers.forEach(clearTimeout);
  app.state = s;
  app.options = o;
  return app;
}
