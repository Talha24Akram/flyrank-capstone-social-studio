import test from "node:test";
import assert from "node:assert/strict";
import { composeAll, composeCaption } from "../src/domain/captions/composer.js";
import { PLATFORM_RULES } from "../src/domain/captions/fragments.js";

const input = { name: "Studio Launch", summary: "Our new design studio opens its doors with a week of free workshops for local makers and teams.", brandVoice: "friendly" };

test("captions differ per platform and both respect their length caps", () => {
  const c = composeAll(input, ["instagram", "x"]);
  assert.notEqual(c.instagram, c.x);
  assert.ok(c.x.length <= 280, `x length ${c.x.length}`);
  assert.ok(c.instagram.length <= 2200);
  assert.match(c.instagram, /#StudioLaunch/);
  assert.match(c.instagram, /link in bio/i);
  assert.doesNotMatch(c.x, /link in bio/i);
});

test("X caption is trimmed to 280 chars for very long summaries and keeps its hashtags", () => {
  const long = { ...input, summary: "word ".repeat(200) };
  const x = composeCaption(long, "x");
  assert.ok(x.length <= 280);
  assert.match(x, /#\w+/);
});

test("brand voice is shared: changing it changes both platforms", () => {
  const a = composeAll({ ...input, brandVoice: "professional" }, ["instagram", "x"]);
  assert.match(a.instagram, /Announcing:/);
  assert.match(a.x, /Announcing:/);
});

test("instagram hashtag count follows the rule table", () => {
  const ig = composeCaption(input, "instagram");
  assert.ok((ig.match(/#\w+/g) || []).length <= PLATFORM_RULES.instagram.hashtagCount);
});
