import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers.js";

async function published(h) {
  const c = await h.newCampaign({ platforms: ["x"] });
  await h.api(`/campaigns/${c.id}/publish`, { method: "POST" });
  h.plat.options.webhookUrl = null; // we deliver webhooks by hand in these tests
  await h.ctx.publishService.tick();
  return { c, e: h.entries(c.id)[0] };
}
const evt = (e, extra = {}) => ({ event_id: "evt_" + Math.random().toString(16).slice(2), post_id: e.external_id, idempotency_key: e.idempotency_key, platform: "x", status: "published", ...extra });

test("probe 4: forged webhook -> 400 and status unchanged; valid webhook -> published", async () => {
  const h = await harness();
  try {
    const { e } = await published(h);
    assert.equal(h.ctx.repos.entries.get(e.id).status, "publishing");
    const forged = await h.postWebhook(evt(e), { secret: "attacker-guess" });
    assert.equal(forged.status, 400);
    assert.equal(h.ctx.repos.entries.get(e.id).status, "publishing", "status unchanged");
    const unsigned = await h.postWebhook(evt(e), { signature: null });
    assert.equal(unsigned.status, 400);
    const truncated = await h.postWebhook(evt(e), { signature: "sha256=00" });
    assert.equal(truncated.status, 400);
    assert.equal(h.ctx.repos.entries.get(e.id).status, "publishing");

    const ok = await h.postWebhook(evt(e));
    assert.equal(ok.status, 200);
    assert.equal(ok.json.status, "published");
    assert.equal(h.ctx.repos.entries.get(e.id).status, "published");
  } finally { await h.close(); }
});

test("a tampered body with a signature for the original body is rejected", async () => {
  const h = await harness();
  try {
    const { e } = await published(h);
    const original = JSON.stringify(evt(e, { status: "failed" }));
    const { signBody } = await import("../src/services/webhookService.js");
    const sig = signBody("whsec-test", original);
    const tampered = original.replace("failed", "published");
    const r = await h.postWebhook(tampered, { signature: sig });
    assert.equal(r.status, 400);
    assert.equal(h.ctx.repos.entries.get(e.id).status, "publishing");
  } finally { await h.close(); }
});

test("replayed event_id is a no-op; failed delivery marks the entry failed", async () => {
  const h = await harness();
  try {
    const { e } = await published(h);
    const ev = evt(e, { status: "failed" });
    assert.equal((await h.postWebhook(ev)).json.result, "applied");
    assert.equal(h.ctx.repos.entries.get(e.id).status, "failed");
    assert.equal((await h.postWebhook(ev)).json.result, "duplicate_event");
  } finally { await h.close(); }
});

test("late 'published' beats a locally recorded failure; unknown entries are ignored; bad payloads are 400", async () => {
  const h = await harness();
  try {
    const { e } = await published(h);
    h.ctx.repos.entries.markFailed(e.id, "gave up", Date.now());
    assert.equal((await h.postWebhook(evt(e))).json.status, "published");
    assert.equal((await h.postWebhook({ ...evt(e), idempotency_key: "nope" })).json.result, "ignored_unknown_entry");
    assert.equal((await h.postWebhook({ nonsense: true })).status, 400);
    assert.equal((await h.postWebhook("not json")).status, 400);
  } finally { await h.close(); }
});
