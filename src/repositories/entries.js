import { tx } from "../db/connection.js";

export function createEntryRepo(db) {
  const ins = db.prepare(`INSERT INTO social_post_entries
    (id,campaign_id,platform,caption,image_path,status,idempotency_key,scheduled_at,next_attempt_at,created_at,updated_at)
    VALUES (@id,@campaign_id,@platform,@caption,@image_path,'queued',@idempotency_key,@scheduled_at,0,@now,@now)`);
  const get = db.prepare("SELECT * FROM social_post_entries WHERE id=?");
  const byKey = db.prepare("SELECT * FROM social_post_entries WHERE idempotency_key=?");
  const byCampaign = db.prepare("SELECT * FROM social_post_entries WHERE campaign_id=? ORDER BY platform");
  const all = db.prepare("SELECT * FROM social_post_entries ORDER BY created_at DESC, platform LIMIT ?");
  const counts = db.prepare("SELECT status, COUNT(*) n FROM social_post_entries GROUP BY status");

  const dueSql = db.prepare(`SELECT id FROM social_post_entries
    WHERE (status='queued' AND scheduled_at IS NOT NULL AND scheduled_at<=@now AND next_attempt_at<=@now)
       OR (status='publishing' AND external_id IS NULL AND lease_until<@now)
    ORDER BY scheduled_at, id LIMIT @limit`);
  const claim = db.prepare(`UPDATE social_post_entries SET status='publishing', lease_until=@lease, attempts=attempts+1, updated_at=@now WHERE id=@id`);

  return {
    insert: (e, now) => ins.run({ scheduled_at: null, ...e, now }),
    get: (id) => get.get(id),
    getByKey: (k) => byKey.get(k),
    byCampaign: (cid) => byCampaign.all(cid),
    recent: (limit = 100) => all.all(limit),
    statusCounts: () => Object.fromEntries(counts.all().map((r) => [r.status, r.n])),

    /** Publish-now: pull scheduled_at forward for entries still queued. Idempotent. */
    scheduleNow(campaignId, now) {
      return db.prepare(`UPDATE social_post_entries SET scheduled_at=?, updated_at=? WHERE campaign_id=? AND status='queued' AND (scheduled_at IS NULL OR scheduled_at>?)`)
        .run(now, now, campaignId, now).changes;
    },
    scheduleAt(campaignId, at, now) {
      return db.prepare(`UPDATE social_post_entries SET scheduled_at=?, updated_at=? WHERE campaign_id=? AND status='queued'`).run(at, now, campaignId).changes;
    },

    /** Atomically claim due work. Two workers can never claim the same row: BEGIN IMMEDIATE serialises them. */
    claimDue(now, leaseSeconds, limit = 10) {
      return tx(db, () => {
        const ids = dueSql.all({ now, limit }).map((r) => r.id);
        for (const id of ids) claim.run({ id, lease: now + leaseSeconds * 1000, now });
        return ids.map((id) => get.get(id));
      });
    },
    markAccepted(id, externalId, now) {
      return db.prepare(`UPDATE social_post_entries SET external_id=?, lease_until=NULL, last_error=NULL, updated_at=? WHERE id=? AND status='publishing'`).run(externalId, now, id).changes;
    },
    release(id, nextAttemptAt, error, now, { countAttempt = true } = {}) {
      return db.prepare(`UPDATE social_post_entries SET status='queued', lease_until=NULL, next_attempt_at=?, last_error=?, attempts=attempts-?, updated_at=? WHERE id=? AND status='publishing'`)
        .run(nextAttemptAt, error, countAttempt ? 0 : 1, now, id).changes;
    },
    markFailed(id, error, now) {
      return db.prepare(`UPDATE social_post_entries SET status='failed', lease_until=NULL, last_error=?, updated_at=? WHERE id=? AND status IN ('queued','publishing')`).run(error, now, id).changes;
    },
    /** Delivery result from webhook/reconcile. Published is final and beats a locally recorded failure. */
    applyDelivery(id, status, externalId, now) {
      if (status === "published") {
        return db.prepare(`UPDATE social_post_entries SET status='published', published_at=COALESCE(published_at,?), external_id=COALESCE(external_id,?), lease_until=NULL, last_error=NULL, updated_at=? WHERE id=? AND status!='published'`).run(now, externalId, now, id).changes;
      }
      return db.prepare(`UPDATE social_post_entries SET status='failed', external_id=COALESCE(external_id,?), lease_until=NULL, last_error='platform reported delivery failure', updated_at=? WHERE id=? AND status IN ('queued','publishing')`).run(externalId, now, id).changes;
    },
    needingReconcile(olderThan, limit = 20) {
      return db.prepare(`SELECT * FROM social_post_entries WHERE status='publishing' AND external_id IS NOT NULL AND updated_at<? ORDER BY updated_at LIMIT ?`).all(olderThan, limit);
    },
  };
}
