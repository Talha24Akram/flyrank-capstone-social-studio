import fs from "node:fs";
import { AuthError, PermanentPublishError, RateLimitedError, TransientPublishError } from "../domain/errors.js";

export function createPublishService({ entries, accounts, publishers, clock, cfg, logger, hooks = {} }) {
  const backoffMs = (attempt) => {
    const base = Math.min(cfg.backoffCapSeconds, cfg.backoffBaseSeconds * 2 ** Math.max(0, attempt - 1));
    return Math.round(base * 1000 * (0.5 + Math.random() * 0.5)); // jitter
  };

  /** Send one claimed entry to its platform. Never throws; every outcome is persisted. */
  async function publishClaimed(entry) {
    const publisher = publishers[entry.platform];
    const image = fs.readFileSync(entry.image_path);
    const req = (accessToken) => publisher.publish({ caption: entry.caption, image, idempotencyKey: entry.idempotency_key, accessToken });
    try {
      let res;
      try {
        res = await req(await accounts.accessToken(entry.platform));
      } catch (e) {
        if (!(e instanceof AuthError)) throw e;
        res = await req(await accounts.accessToken(entry.platform, { forceRefresh: true })); // one refresh-and-retry
      }
      await hooks.afterPlatformCall?.(entry, res); // test/chaos hook: crash between "platform accepted" and "we recorded it"
      entries.markAccepted(entry.id, res.externalId, clock.now());
      logger.info("accepted by platform", { entry: entry.id, platform: entry.platform, externalId: res.externalId, replayed: Boolean(res.replayed) });
      return "accepted";
    } catch (e) {
      if (e?.simulatedCrash) throw e; // test hook: behaves like the process dying here (nothing is persisted)
      const now = clock.now();
      if (e instanceof RateLimitedError) {
        entries.release(entry.id, now + e.retryAfterSeconds * 1000, e.message, now, { countAttempt: false });
        logger.warn("rate limited, rescheduled", { entry: entry.id, retryAfterSeconds: e.retryAfterSeconds });
        return "rate_limited";
      }
      const transient = e instanceof TransientPublishError || e instanceof AuthError;
      if (transient && entry.attempts < cfg.maxAttempts) {
        const wait = backoffMs(entry.attempts);
        entries.release(entry.id, now + wait, e.message, now);
        logger.warn("transient failure, backing off", { entry: entry.id, attempt: entry.attempts, waitMs: wait, error: e.message });
        return "retry";
      }
      entries.markFailed(entry.id, e instanceof PermanentPublishError ? e.message : `gave up after ${entry.attempts} attempts: ${e.message}`, now);
      logger.error("entry failed", { entry: entry.id, error: e.message });
      return "failed";
    }
  }

  return {
    publishClaimed,
    /** One scheduler pass: claim due entries (atomic, leased) and publish them. */
    async tick(limit = 10) {
      const claimed = entries.claimDue(clock.now(), cfg.leaseSeconds, limit);
      const results = [];
      for (const e of claimed) results.push({ id: e.id, platform: e.platform, outcome: await publishClaimed(e) });
      return results;
    },
    /** Safety net for lost webhooks: ask the platform about entries stuck in 'publishing'. */
    async reconcile() {
      const stuck = entries.needingReconcile(clock.now() - cfg.reconcileAfterSeconds * 1000);
      let applied = 0;
      for (const e of stuck) {
        try {
          const { status } = await publishers[e.platform].getStatus({ externalId: e.external_id, accessToken: await accounts.accessToken(e.platform) });
          if (status === "published" || status === "failed") applied += entries.applyDelivery(e.id, status, e.external_id, clock.now());
        } catch (err) { logger.warn("reconcile failed", { entry: e.id, error: err.message }); }
      }
      return applied;
    },
  };
}
