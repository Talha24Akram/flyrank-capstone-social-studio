import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { harness } from "./helpers.js";

test("validation: bad input is always a 4xx with details, never a 500", async () => {
  const h = await harness();
  try {
    const bad = [
      {}, { name: "", summary: "x" }, { name: "n" }, { name: "n", summary: "s", platforms: ["tiktok"] }, { name: "n", summary: "s", platforms: [] },
      { name: "n", summary: "s", brandVoice: "angry" }, { name: "n".repeat(500), summary: "s" }, { name: "n", summary: "s", extra: 1 },
      { name: "n", summary: "s", scheduleAt: "not-a-date" }, { name: "n", summary: "s", subject: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } },
      { name: "n", summary: "s", imageBase64: "AAAAAAAAAAAAAAAAAAAAAA==" },
      { name: 5, summary: [] },
    ];
    for (const body of bad) {
      const r = await h.api("/campaigns", { method: "POST", body });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80) + " -> " + r.status);
    }
    const malformed = await fetch(h.base + "/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
    assert.equal(malformed.status, 400);
    assert.equal((await h.api("/campaigns/nope")).status, 404);
    assert.equal((await h.api("/campaigns/cmp_0123456789abcdef")).status, 404);
    assert.equal((await h.api("/campaigns/cmp_0123456789abcdef/publish", { method: "POST" })).status, 404);
    assert.equal((await h.api("/campaigns/cmp_0123456789abcdef/schedule", { method: "POST", body: { at: "x" } })).status, 400);
    assert.equal((await h.api("/media/../../etc/passwd")).status, 404);
    assert.equal((await h.api("/admin/clock/advance", { method: "POST", body: { seconds: -5 } })).status, 400);
    assert.equal((await h.api("/nothing-here")).status, 404);
  } finally { await h.close(); }
});

test("creating a campaign yields correctly sized images and different captions per platform", async () => {
  const h = await harness();
  try {
    const c = await h.newCampaign({ brandVoice: "playful" });
    assert.deepEqual(c.entries.map((e) => e.platform), ["instagram", "x"]);
    assert.ok(c.entries.every((e) => e.status === "queued"));
    assert.notEqual(c.entries[0].caption, c.entries[1].caption);
    const dims = {};
    for (const e of c.entries) {
      const r = await fetch(h.base + e.imageUrl);
      assert.equal(r.headers.get("content-type"), "image/jpeg");
      const m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
      dims[e.platform] = [m.width, m.height];
    }
    assert.deepEqual(dims, { instagram: [1080, 1080], x: [1600, 900] });
  } finally { await h.close(); }
});

test("uploaded images work, and Idempotency-Key on create returns the same campaign", async () => {
  const h = await harness();
  try {
    const img = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#3366aa" } }).png().toBuffer();
    const body = { name: "Upload", summary: "A user supplied hero image.", imageBase64: img.toString("base64"), subject: { x: 0.35, y: 0.35, w: 0.3, h: 0.3 } };
    const a = await h.api("/campaigns", { method: "POST", body, headers: { "idempotency-key": "same-click" } });
    const b = await h.api("/campaigns", { method: "POST", body, headers: { "idempotency-key": "same-click" } });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.json.id, b.json.id);
    assert.equal(h.ctx.repos.campaigns.list().length, 1);
  } finally { await h.close(); }
});

test("publish is idempotent over HTTP and the dashboard JSON reflects the state", async () => {
  const h = await harness();
  try {
    const c = await h.newCampaign();
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => h.api(`/campaigns/${c.id}/publish`, { method: "POST" })));
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal(h.ctx.repos.entries.byCampaign(c.id).length, 2);
    await h.ctx.publishService.tick();
    await h.ctx.publishService.tick();
    assert.equal(h.plat.state.posts.size, 2);
    const d = await h.api("/dashboard.json");
    assert.equal(d.json.campaigns[0].id, c.id);
    assert.ok((await fetch(h.base + "/dashboard")).headers.get("content-type").includes("html"));
  } finally { await h.close(); }
});
