import crypto from "node:crypto";
import { z } from "zod";
import { badRequest } from "../domain/errors.js";

const eventSchema = z.object({
  event_id: z.string().min(1).max(128),
  post_id: z.string().min(1).max(128),
  idempotency_key: z.string().min(1).max(256),
  platform: z.enum(["instagram", "x"]),
  status: z.enum(["published", "failed"]),
  delivered_at: z.string().optional(),
});

export function signBody(secret, rawBody) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function createWebhookService({ entries, events, clock, cfg, logger }) {
  function verify(rawBody, header) {
    if (!header || typeof header !== "string") return false;
    const expected = Buffer.from(signBody(cfg.webhookSecret, rawBody));
    const got = Buffer.from(header);
    return got.length === expected.length && crypto.timingSafeEqual(got, expected); // constant-time
  }

  return {
    verify,
    /** Returns {result}. Throws AppError(400) for a bad signature or malformed payload; state is untouched in that case. */
    handle(rawBody, signature) {
      if (!verify(rawBody, signature)) {
        logger.warn("webhook rejected: bad signature");
        throw badRequest("invalid signature");
      }
      let parsed;
      try { parsed = eventSchema.parse(JSON.parse(rawBody.toString("utf8"))); } catch { throw badRequest("malformed webhook payload"); }
      const entry = entries.getByKey(parsed.idempotency_key);
      if (!entry || entry.platform !== parsed.platform) return { result: "ignored_unknown_entry" };
      if (!events.record(parsed.event_id, entry.id, clock.now())) return { result: "duplicate_event" };
      const changed = entries.applyDelivery(entry.id, parsed.status, parsed.post_id, clock.now());
      logger.info("delivery webhook applied", { entry: entry.id, status: parsed.status, changed });
      return { result: changed ? "applied" : "no_change", entryId: entry.id, status: entries.get(entry.id).status };
    },
  };
}
