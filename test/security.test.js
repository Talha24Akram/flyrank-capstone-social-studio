import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { harness } from "./helpers.js";
import { createTokenVault } from "../src/domain/tokenVault.js";
import { redact } from "../src/logger.js";
import { parseRetryAfter } from "../src/adapters/SocialPublisher.js";

test("vault: round-trips, uses a fresh random IV, binds to the account, rejects tampering", () => {
  const v = createTokenVault("cd".repeat(32));
  const a = v.encrypt("at_secretvalue", "account:x"), b = v.encrypt("at_secretvalue", "account:x");
  assert.notEqual(a, b, "same plaintext encrypts differently each time (random IV)");
  assert.equal(v.decrypt(a, "account:x"), "at_secretvalue");
  assert.throws(() => v.decrypt(a, "account:instagram"), "wrong AAD");
  const parts = a.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => v.decrypt(parts.join("."), "account:x"));
  assert.throws(() => createTokenVault("short"));
});

test("probe 6: no plaintext token in the database file or the logs", async () => {
  const h = await harness();
  try {
    const c = await h.newCampaign();
    await h.api(`/campaigns/${c.id}/publish`, { method: "POST" });
    await h.ctx.publishService.tick();
    // grab the real plaintext tokens the platform issued
    const secrets = [...h.plat.state.tokens.keys(), ...h.plat.state.refresh.keys()];
    assert.ok(secrets.length >= 4);
    h.ctx.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const dbBytes = fs.readFileSync(path.join(h.tmp, "db.sqlite"));
    const wal = fs.existsSync(path.join(h.tmp, "db.sqlite-wal")) ? fs.readFileSync(path.join(h.tmp, "db.sqlite-wal")) : Buffer.alloc(0);
    const rows = JSON.stringify(h.ctx.db.prepare("SELECT * FROM accounts").all());
    const logText = h.logs.join("\n");
    for (const s of secrets) {
      assert.ok(!dbBytes.includes(s), "token found in db file");
      assert.ok(!wal.includes(s), "token found in WAL");
      assert.ok(!rows.includes(s), "token found in accounts rows");
      assert.ok(!logText.includes(s), "token found in logs");
    }
    assert.ok(h.ctx.db.prepare("SELECT access_token_enc FROM accounts").get().access_token_enc.startsWith("v1."));
    assert.ok(logText.length > 0);
  } finally { await h.close(); }
});

test("logger redacts secrets even when a caller logs a whole object", () => {
  const out = redact({ user: "u", access_token: "at_abcdefabcdefabcdefabcd", headers: { authorization: "Bearer abc.def", ok: 1 }, msg: "got Bearer zzz123 now" });
  const s = JSON.stringify(out);
  assert.ok(!s.includes("abcdefabcdef") && !s.includes("abc.def") && !s.includes("zzz123"));
  assert.equal(out.user, "u");
});

test("expired token is refreshed transparently; a rejected token triggers one refresh-and-retry", async () => {
  const h = await harness();
  try {
    const before = h.ctx.repos.accounts.get("x").access_token_enc;
    h.advance(3600); // token is now past expiry on the app clock
    const c = await h.newCampaign({ platforms: ["x"] });
    await h.api(`/campaigns/${c.id}/publish`, { method: "POST" });
    assert.equal((await h.ctx.publishService.tick())[0].outcome, "accepted");
    assert.notEqual(h.ctx.repos.accounts.get("x").access_token_enc, before, "token rotated");

    // platform revokes the token behind our back -> 401 -> refresh -> retry succeeds
    h.plat.state.tokens.clear();
    const c2 = await h.newCampaign({ name: "Second", platforms: ["x"] });
    await h.api(`/campaigns/${c2.id}/publish`, { method: "POST" });
    assert.equal((await h.ctx.publishService.tick())[0].outcome, "accepted");
  } finally { await h.close(); }
});

test("Retry-After parsing: seconds, HTTP-date, junk", () => {
  assert.equal(parseRetryAfter("30"), 30);
  assert.equal(parseRetryAfter(null), 30);
  assert.equal(parseRetryAfter("soon"), 30);
  const d = new Date(Date.now() + 12_000).toUTCString();
  assert.ok(Math.abs(parseRetryAfter(d) - 12) <= 2);
});
