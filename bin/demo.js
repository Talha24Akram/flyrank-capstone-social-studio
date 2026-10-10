// Scripted demo against the RUNNING stack (`npm start` + `npm run seed`). Prints a verdict per step; exits non-zero on failure.
import crypto from "node:crypto";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const API = process.env.BASE_URL || `http://localhost:${cfg.port}`;
const PLAT = cfg.platformUrl;
let failed = 0;
const ok = (c, msg) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) failed++; };
const step = (t) => console.log(`\n== ${t}`);
const j = async (url, init = {}) => {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) }, body: init.body && typeof init.body !== "string" ? JSON.stringify(init.body) : init.body });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(300); }
  return null;
}
const appNow = async () => (await j(`${API}/admin/clock`)).body.now; // the shared, advanceable app clock (not Date.now())
const advance = (seconds) => j(`${API}/admin/clock/advance`, { method: "POST", body: { seconds } });
const getC = async (id) => (await j(`${API}/campaigns/${id}`)).body;
const statuses = (c) => Object.fromEntries(c.entries.map((e) => [e.platform, e.status]));
const allPublished = async (id) => { const c = await getC(id); return c.entries.every((e) => e.status === "published") ? c : null; };
const platformState = async () => (await j(`${PLAT}/__admin/state`)).body;
const postsFor = async (id) => (await platformState()).list.filter((p) => String(p.idempotencyKey || p.idempotency_key || "").startsWith(id));
const run = Date.now().toString(36);

await j(`${PLAT}/__admin/faults`, { method: "POST", body: { rateLimitNext: 0, failNext: 0, dropNext: 0, randomFailRate: 0, webhookFailRate: 0, webhookDelayMs: null } });

step("1. create campaign -> per-platform images and captions");
const create = await j(`${API}/campaigns`, { method: "POST", headers: { "idempotency-key": `demo-${run}-a` }, body: { name: `Demo ${run}`, summary: "Open studio day: free workshops, coffee, and a first look at our new prints.", brandVoice: "playful", platforms: ["instagram", "x"] } });
ok(create.status === 201 || create.status === 200, `created (HTTP ${create.status})`);
const camp = create.body.campaign || create.body;
const [ig, x] = ["instagram", "x"].map((p) => camp.entries.find((e) => e.platform === p));
console.log(`  instagram caption: ${ig.caption.replace(/\n/g, " ⏎ ")}`);
console.log(`  x caption        : ${x.caption.replace(/\n/g, " ⏎ ")}`);
ok(ig.caption !== x.caption, "captions differ per platform");
ok(x.caption.length <= 280, `x caption within 280 chars (${x.caption.length})`);
const dims = {};
for (const p of ["instagram", "x"]) {
  const buf = Buffer.from(await (await fetch(`${API}/media/${camp.id}/${p}.jpg`)).arrayBuffer());
  const { default: sharp } = await import("sharp");
  const m = await sharp(buf).metadata(); dims[p] = `${m.width}x${m.height}`;
}
ok(dims.instagram === "1080x1080" && dims.x === "1600x900", `image variants ${JSON.stringify(dims)}`);

step("2. schedule for +1h, advance the shared clock, worker publishes");
const at = (await appNow()) + 3600_000;
const sch = await j(`${API}/campaigns/${camp.id}/schedule`, { method: "POST", body: { at } });
ok(sch.status === 200, `scheduled (HTTP ${sch.status}) -> ${JSON.stringify(statuses(sch.body))}`);
await sleep(1500);
ok(Object.values(statuses(await getC(camp.id))).every((s) => s === "queued"), "still queued before its time");
await advance(3601);
const done = await waitFor(() => allPublished(camp.id));
ok(!!done, `published after clock advance -> ${JSON.stringify(statuses(await getC(camp.id)))}`);

step("3. idempotency hammer: 10 parallel publishes + same Idempotency-Key re-create");
const rs = await Promise.all(Array.from({ length: 10 }, () => j(`${API}/campaigns/${camp.id}/publish`, { method: "POST" })));
ok(rs.every((r) => r.status < 400), `all 10 publish calls answered 2xx (${[...new Set(rs.map((r) => r.status))]})`);
const again = await j(`${API}/campaigns`, { method: "POST", headers: { "idempotency-key": `demo-${run}-a` }, body: { name: `Demo ${run}`, summary: "Open studio day: free workshops, coffee, and a first look at our new prints.", brandVoice: "playful", platforms: ["instagram", "x"] } });
ok((again.body.campaign || again.body).id === camp.id, "re-sent create with the same key returns the same campaign");
await sleep(2000);
const ps = (await postsFor(camp.id));
ok(ps.length === 2 && new Set(ps.map((p) => p.platform)).size === 2, `platform holds exactly 1 post per platform for this campaign (${ps.length})`);

step("4. 429 with Retry-After: 30 -> wait -> retry -> success");
await j(`${PLAT}/__admin/faults`, { method: "POST", body: { rateLimitNext: 1, retryAfter: 30 } });
const c2 = (await j(`${API}/campaigns`, { method: "POST", headers: { "idempotency-key": `demo-${run}-b` }, body: { name: `Rate limit ${run}`, summary: "Second campaign to exercise 429 backoff.", platforms: ["instagram"] } })).body;
const c2id = (c2.campaign || c2).id;
await j(`${API}/campaigns/${c2id}/publish`, { method: "POST" });
const now0 = await appNow();
const waiting = await waitFor(async () => { const c = await getC(c2id); const e = c.entries[0]; return e.status === "queued" && e.nextAttemptAt > now0 + 20_000 ? e : null; }, 8000);
ok(!!waiting, waiting ? `released to queued, next attempt in ~${Math.round((waiting.nextAttemptAt - now0) / 1000)}s (Retry-After honoured)` : "entry was not backed off");
await sleep(1500);
ok((await getC(c2id)).entries[0].status === "queued", "not retried early");
await advance(31);
ok(!!(await waitFor(() => allPublished(c2id))), "retried after the wait and published");
ok((await postsFor(c2id)).length === 1, "exactly 1 post on the platform");

step("5. webhook: forged -> 400 (status unchanged), valid -> published");
await j(`${PLAT}/__admin/faults`, { method: "POST", body: { webhookDelayMs: 600000 } }); // keep the real delivery away so we can drive it by hand
const c3 = (await j(`${API}/campaigns`, { method: "POST", headers: { "idempotency-key": `demo-${run}-c` }, body: { name: `Webhook ${run}`, summary: "Third campaign to exercise the signed webhook.", platforms: ["x"] } })).body;
const c3id = (c3.campaign || c3).id;
await j(`${API}/campaigns/${c3id}/publish`, { method: "POST" });
const pub = await waitFor(async () => { const e = (await getC(c3id)).entries[0]; return e.status === "publishing" && e.externalId ? e : null; }, 10000);
ok(!!pub, `entry is 'publishing' with platform id ${pub?.externalId}`);
const payload = JSON.stringify({ event_id: `evt-${run}`, post_id: pub.externalId, idempotency_key: `${c3id}:x`, platform: "x", status: "published", delivered_at: new Date().toISOString() });
const forged = await fetch(`${API}/webhook/social-delivery`, { method: "POST", headers: { "content-type": "application/json", "x-signature": "sha256=" + "0".repeat(64) }, body: payload });
ok(forged.status === 400, `forged signature -> HTTP ${forged.status}`);
ok((await getC(c3id)).entries[0].status === "publishing", "status unchanged after forged webhook");
const sig = "sha256=" + crypto.createHmac("sha256", cfg.webhookSecret).update(payload).digest("hex");
const valid = await fetch(`${API}/webhook/social-delivery`, { method: "POST", headers: { "content-type": "application/json", "x-signature": sig }, body: payload });
ok(valid.status === 200, `valid signature -> HTTP ${valid.status}`);
ok((await getC(c3id)).entries[0].status === "published", "status is now published");
await j(`${PLAT}/__admin/faults`, { method: "POST", body: { webhookDelayMs: null } });

step("6. summary");
const dash = (await j(`${API}/dashboard.json`)).body;
console.log("  status counts:", JSON.stringify(dash.counts));
console.log(`  dashboard: ${API}/dashboard`);
console.log(failed ? `\nDEMO FAILED (${failed} checks)` : "\nDEMO OK - all checks passed");
process.exit(failed ? 1 : 0);
