import express from "express";
import { ZodError } from "zod";
import { AppError, badRequest, notFound } from "../domain/errors.js";
import { advanceSchema, createCampaignSchema, idParam, scheduleSchema } from "./schemas.js";
import { dashboardHtml } from "./dashboard.js";

const parse = (schema, body) => {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw r.error;
  return r.data;
};
const checkId = (id) => { if (!idParam.test(id)) throw notFound("campaign not found"); return id; };

export function createApp(ctx) {
  const { campaignService, webhookService, clock, repos, accountService, cfg, logger } = ctx;
  const app = express();
  app.disable("x-powered-by");

  // Webhook first: it needs the RAW body to verify the HMAC, so it must not go through express.json.
  app.post("/webhook/social-delivery", express.raw({ type: "*/*", limit: "100kb" }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const out = webhookService.handle(raw, req.get("x-signature"));
    res.status(200).json(out);
  });

  app.use(express.json({ limit: "15mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/campaigns", async (req, res) => {
    const input = parse(createCampaignSchema, req.body);
    const { campaign, created } = await campaignService.create(input, { idempotencyKey: req.get("idempotency-key") || undefined });
    res.status(created ? 201 : 200).json(campaign);
  });
  app.get("/campaigns", (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    res.json({ items: campaignService.list(limit, offset), limit, offset });
  });
  app.get("/campaigns/:id", (req, res) => res.json(campaignService.get(checkId(req.params.id))));
  app.post("/campaigns/:id/publish", (req, res) => res.json(campaignService.publish(checkId(req.params.id))));
  app.post("/campaigns/:id/schedule", (req, res) => {
    const { at } = parse(scheduleSchema, req.body);
    res.json(campaignService.schedule(checkId(req.params.id), at));
  });

  app.get("/media/:cid/:file", (req, res) => {
    const m = /^(instagram|x)\.jpg$/.exec(req.params.file);
    if (!m) throw notFound("media not found");
    res.type("image/jpeg").sendFile(campaignService.mediaPath(checkId(req.params.cid), m[1]));
  });

  app.get("/dashboard.json", (_req, res) => {
    res.json({
      now: clock.now(), clockOffsetMs: clock.offsetMs(), counts: repos.entries.statusCounts(),
      accounts: accountService.list(),
      campaigns: campaignService.list(20, 0),
    });
  });
  app.get("/dashboard", (_req, res) => res.type("html").send(dashboardHtml));

  if (cfg.enableAdmin) {
    app.get("/admin/clock", (_req, res) => res.json({ now: clock.now(), offsetMs: clock.offsetMs() }));
    app.post("/admin/clock/advance", (req, res) => {
      const { seconds } = parse(advanceSchema, req.body);
      clock.advance(seconds);
      res.json({ now: clock.now(), offsetMs: clock.offsetMs() });
    });
  }

  app.use((_req, _res, next) => next(notFound("route not found")));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "validation_error", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (err instanceof AppError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "bad_request", message: "malformed JSON" });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "payload_too_large" });
    logger.error("unhandled error", { error: err?.message });
    res.status(500).json({ error: "internal_error" }); // never leak internals
  });
  return app;
}
export { badRequest };
