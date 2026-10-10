import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { tx } from "../db/connection.js";
import { badRequest, notFound } from "../domain/errors.js";
import { makeAllVariants, sampleHero } from "../domain/images.js";
import { composeAll } from "../domain/captions/composer.js";

export function createCampaignService({ db, campaigns, entries, clock, cfg }) {
  const id = (p) => p + crypto.randomBytes(8).toString("hex");

  function view(c) {
    const es = entries.byCampaign(c.id).map((e) => ({
      id: e.id, platform: e.platform, status: e.status, caption: e.caption, imageUrl: `/media/${c.id}/${e.platform}.jpg`,
      scheduledAt: e.scheduled_at, nextAttemptAt: e.next_attempt_at, attempts: e.attempts, externalId: e.external_id, lastError: e.last_error, publishedAt: e.published_at,
    }));
    return { id: c.id, name: c.name, summary: c.summary, brandVoice: c.brand_voice, createdAt: c.created_at, entries: es };
  }

  return {
    view,
    async create(input, { idempotencyKey } = {}) {
      if (idempotencyKey) {
        const prior = campaigns.getByKey(idempotencyKey);
        if (prior) return { campaign: view(prior), created: false };
      }
      let hero, subject = input.subject;
      if (input.imageBase64) {
        hero = Buffer.from(input.imageBase64, "base64");
        try { await sharp(hero).metadata(); } catch { throw badRequest("imageBase64 is not a readable image"); }
        subject ??= { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
      } else {
        const s = await sampleHero();
        hero = s.buffer; subject ??= s.subject;
      }
      const platforms = input.platforms;
      const cid = id("cmp_");
      const dir = path.join(cfg.mediaDir, cid);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "hero.jpg"), hero);
      const variants = await makeAllVariants(hero, subject, platforms);
      const captions = composeAll({ name: input.name, summary: input.summary, brandVoice: input.brandVoice }, platforms);
      const now = clock.now();
      for (const p of platforms) fs.writeFileSync(path.join(dir, `${p}.jpg`), variants[p].buffer);

      try {
        tx(db, () => {
          campaigns.insert({
            id: cid, name: input.name, summary: input.summary, brand_voice: input.brandVoice, hero_path: path.join(dir, "hero.jpg"),
            subject_x: subject.x, subject_y: subject.y, subject_w: subject.w, subject_h: subject.h, idempotency_key: idempotencyKey ?? null, created_at: now,
          });
          for (const p of platforms) {
            entries.insert({
              id: id("ent_"), campaign_id: cid, platform: p, caption: captions[p], image_path: path.join(dir, `${p}.jpg`),
              idempotency_key: `${cid}:${p}`, scheduled_at: input.scheduleAt ?? null,
            }, now);
          }
        });
      } catch (e) {
        // two concurrent creates with the same Idempotency-Key: the loser returns the winner's campaign
        const prior = idempotencyKey && campaigns.getByKey(idempotencyKey);
        if (prior) return { campaign: view(prior), created: false };
        throw e;
      }
      return { campaign: view(campaigns.get(cid)), created: true };
    },

    get(cid) {
      const c = campaigns.get(cid);
      if (!c) throw notFound("campaign not found");
      return view(c);
    },
    list: (limit, offset) => campaigns.list(limit, offset).map(view),

    /** Idempotent: calling it N times leaves exactly the same rows, so exactly one post per platform. */
    publish(cid) {
      if (!campaigns.get(cid)) throw notFound("campaign not found");
      entries.scheduleNow(cid, clock.now());
      return this.get(cid);
    },
    schedule(cid, at) {
      if (!campaigns.get(cid)) throw notFound("campaign not found");
      entries.scheduleAt(cid, at, clock.now());
      return this.get(cid);
    },
    mediaPath(cid, platform) {
      const e = entries.byCampaign(cid).find((x) => x.platform === platform);
      if (!e) throw notFound("media not found");
      return e.image_path;
    },
  };
}
