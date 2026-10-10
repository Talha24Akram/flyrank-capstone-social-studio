import test from "node:test";
import assert from "node:assert/strict";
import { harness, until } from "./helpers.js";
import { createContext } from "../src/context.js";
import { createLogger } from "../src/logger.js";

test("probe 1: publish twice, then retry after a dropped response -> exactly one post per platform", async () => {
  const h = await harness();
  try {
    const c = await h.newCampaign();
    // client hammers the publish endpoint
    for (let i = 0; i < 3; i++) assert.equal((await h.api(`/campaigns/${c.id}/publish`, { method: "POST" })).status, 200);
    assert.equal(h.entries(c.id).length, 2);

    // the platform accepts both posts but the responses never arrive (client-side timeout)
    await h.plat.state.faults && Object.assign(h.plat.state.faults, { dropNext: 2 });
    const first = await h.ctx.publishService.tick();
    assert.deepEqual(first.map((r) => r.outcome), ["retry", "retry"]);
    assert.equal(h.plat.state.posts.size, 2, "platform already has the posts");

    h.advance(60); // wait out the backoff, then the worker retries with the SAME idempotency key
    const second = await h.ctx.publishService.tick();
    assert.deepEqual(second.map((r) => r.outcome), ["accepted", "accepted"]);

    assert.equal(h.plat.state.posts.size, 2, "no duplicate posts");
    assert.equal(h.plat.state.calls.replayed, 2);
    const counts = h.plat.state.posts;
    assert.equal([...counts.values()].filter((p) => p.platform === "instagram").length, 1);
    assert.equal([...counts.values()].filter((p) => p.platform === "x").length, 1);
  } finally { await h.close(); }
});

test("probe 2: 429 with Retry-After: 30 waits 30s (durably), then succeeds", async () => {
  const h = await harness();
  try {
    const c = await h.newCampaign();
    await h.api(`/campaigns/${c.id}/publish`, { method: "POST" });
    Object.assign(h.plat.state.faults, { rateLimitNext: 2, retryAfter: 30 });
    const t0 = h.ctx.clock.now();
    const r1 = await h.ctx.publishService.tick();
    assert.deepEqual(r1.map((r) => r.outcome), ["rate_limited", "rate_limited"]);
    for (const e of h.entries(c.id)) {
      assert.equal(e.status, "queued");
      assert.equal(e.attempts, 0, "a 429 does not burn an attempt");
      assert.ok(e.next_attempt_at >= t0 + 30_000 - 50 && e.next_attempt_at <= t0 + 31_000, "scheduled ~30s ahead");
    }
    assert.equal((await h.ctx.publishService.tick()).length, 0, "nothing runs before Retry-After elapses");
    h.advance(29);
    assert.equal((await h.ctx.publishService.tick()).length, 0, "still waiting at 29s");
    h.advance(2);
    const r2 = await h.ctx.publishService.tick();
    assert.deepEqual(r2.map((r) => r.outcome), ["accepted", "accepted"]);
    assert.equal(h.plat.state.posts.size, 2);
  } finally { await h.close(); }
});

test("probe 3: worker dies mid-batch (after platform accepted, before saving) -> restart creates zero duplicates", async () => {
  let crashed = 0;
  const hooks = { afterPlatformCall: () => { if (!crashed++) { const e = new Error("kill -9"); e.simulatedCrash = true; throw e; } } };
  const h = await harness({ hooks });
  try {
    const campaigns = [];
    for (let i = 0; i < 3; i++) { const c = await h.newCampaign({ name: `Batch ${i}` }); await h.api(`/campaigns/${c.id}/publish`, { method: "POST" }); campaigns.push(c); }
    await assert.rejects(() => h.ctx.publishService.tick(), /kill -9/);
    assert.equal(h.plat.state.posts.size, 1, "the first post reached the platform before the crash");
    // the whole claimed batch is leased to the dead worker, so a restart waits for the lease instead of racing it
    assert.equal((await h.ctx.publishService.tick()).length, 0, "leases still valid right after the crash");
    h.advance(31); // leases expire -> the orphaned batch is re-claimed
    const rest = await h.ctx.publishService.tick();
    assert.equal(rest.length, 6);
    assert.ok(rest.every((r) => r.outcome === "accepted"));
    assert.equal(h.plat.state.posts.size, 6, "3 campaigns x 2 platforms, no duplicates");
    assert.equal(h.plat.state.calls.replayed, 1, "the re-sent request was answered from the idempotency record");
  } finally { await h.close(); }
});

test("two workers on one database never claim the same entry", async () => {
  const h = await harness();
  const ctx2 = createContext(h.ctx.cfg, { logger: createLogger("w2", () => {}) });
  try {
    for (let i = 0; i < 8; i++) { const c = await h.newCampaign({ name: `Race ${i}` }); await h.api(`/campaigns/${c.id}/publish`, { method: "POST" }); }
    const [a, b] = await Promise.all([h.ctx.publishService.tick(10), ctx2.publishService.tick(10), h.ctx.publishService.tick(10)]);
    const ids = [...a, ...b].map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, "no entry handled twice");
    await h.ctx.publishService.tick(10);
    assert.equal(h.plat.state.posts.size, 16);
    assert.equal(h.plat.state.calls.replayed, 0);
  } finally { ctx2.db.close(); await h.close(); }
});

test("transient 503s back off exponentially, then permanent failure is recorded after max attempts", async () => {
  const h = await harness({ cfg: { maxAttempts: 3 } });
  try {
    const c = await h.newCampaign({ platforms: ["x"] });
    await h.api(`/campaigns/${c.id}/publish`, { method: "POST" });
    Object.assign(h.plat.state.faults, { failNext: 99 });
    const waits = [];
    for (let i = 0; i < 3; i++) {
      const r = await h.ctx.publishService.tick();
      const e = h.entries(c.id)[0];
      waits.push(e.next_attempt_at - h.ctx.clock.now());
      assert.equal(r[0].outcome, i < 2 ? "retry" : "failed");
      h.advance(600);
    }
    const e = h.entries(c.id)[0];
    assert.equal(e.status, "failed");
    assert.match(e.last_error, /gave up after 3 attempts/);
    assert.ok(waits[1] > waits[0], `backoff grows: ${waits}`);
  } finally { await h.close(); }
});

test("end to end: queued -> publishing -> published via signed delivery webhook", async () => {
  const h = await harness();
  try {
    const c = await h.newCampaign();
    await h.api(`/campaigns/${c.id}/publish`, { method: "POST" });
    await h.ctx.publishService.tick();
    assert.ok(h.entries(c.id).every((e) => e.status === "publishing" && e.external_id));
    await until(() => h.entries(c.id).every((e) => e.status === "published"));
    assert.ok(h.entries(c.id).every((e) => e.published_at));
  } finally { await h.close(); }
});

test("scheduled campaigns do nothing until their time; advancing the clock releases them", async () => {
  const h = await harness();
  try {
    const at = h.ctx.clock.now() + 3600_000;
    const c = await h.newCampaign({ scheduleAt: at });
    assert.equal((await h.ctx.publishService.tick()).length, 0);
    h.advance(3601);
    assert.equal((await h.ctx.publishService.tick()).length, 2);
  } finally { await h.close(); }
});

test("lost webhook: reconcile polls the platform and settles the entry", async () => {
  const h = await harness({ platform: { webhookUrl: null }, cfg: { reconcileAfterSeconds: 10 } });
  try {
    const c = await h.newCampaign();
    await h.api(`/campaigns/${c.id}/publish`, { method: "POST" });
    h.plat.options.webhookUrl = null; // webhooks are lost
    await h.ctx.publishService.tick();
    await new Promise((r) => setTimeout(r, 120)); // platform flips its own status to published
    h.advance(11);
    assert.equal(await h.ctx.publishService.reconcile(), 2);
    assert.ok(h.entries(c.id).every((e) => e.status === "published"));
  } finally { await h.close(); }
});
