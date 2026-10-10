import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { makeVariant, makeAllVariants, sampleHero, VARIANTS } from "../src/domain/images.js";

test("Instagram variant is exactly 1080x1080 and X is exactly 1600x900", async () => {
  const { buffer, subject } = await sampleHero();
  const v = await makeAllVariants(buffer, subject);
  const ig = await sharp(v.instagram.buffer).metadata();
  const x = await sharp(v.x.buffer).metadata();
  assert.deepEqual([ig.width, ig.height], [1080, 1080]);
  assert.deepEqual([x.width, x.height], [1600, 900]);
  assert.equal(ig.format, "jpeg");
});

test("subject stays inside the safe zone on every platform", async () => {
  const { buffer, subject } = await sampleHero();
  for (const p of Object.keys(VARIANTS)) {
    const r = await makeVariant(buffer, p, subject);
    assert.ok(r.subjectInSafeZone, `${p}: ${JSON.stringify(r.subjectRect)}`);
  }
});

test("a subject too wide for a crop falls back to contain (nothing cut off)", async () => {
  const wide = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#336" } }).png().toBuffer();
  const r = await makeVariant(wide, "instagram", { x: 0.05, y: 0.3, w: 0.9, h: 0.4 });
  assert.equal(r.mode, "contain");
  assert.equal(r.width, 1080);
  const meta = await sharp(r.buffer).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1080]);
});

test("unknown platform is rejected", async () => {
  const { buffer, subject } = await sampleHero();
  await assert.rejects(() => makeVariant(buffer, "tiktok", subject));
});
