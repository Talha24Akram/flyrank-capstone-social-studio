import { BRAND_VOICES, PLATFORM_RULES, EMOJI_POOL } from "./fragments.js";

const words = (s) => s.split(/\s+/).filter(Boolean);
const toHashtag = (w) => "#" + w.replace(/[^A-Za-z0-9]/g, "").replace(/^(.)/, (c) => c.toUpperCase());

function pickHashtags(campaignName, summary, n) {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "our", "are", "you", "your", "new", "a", "an", "of", "to", "in", "on"]);
  const candidates = [campaignName, ...words(summary)]
    .map((w) => w.replace(/[^A-Za-z0-9 ]/g, ""))
    .filter((w) => w.length > 3 && !stop.has(w.toLowerCase()));
  const tags = [];
  const whole = toHashtag(campaignName.split(/\s+/).join(" ").replace(/\s+/g, ""));
  if (whole.length > 2) tags.push(whole);
  for (const c of candidates) {
    const t = toHashtag(c);
    if (t.length > 3 && !tags.includes(t)) tags.push(t);
    if (tags.length >= n) break;
  }
  return tags.slice(0, n);
}

function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max - 1));
  return cut.replace(/\s+\S*$/, "") + "…";
}

/** Step 1: assemble the platform-independent + platform-specific fragments into a spec. */
export function buildCaptionSpec({ name, summary, brandVoice = "friendly" }, platform) {
  const voice = BRAND_VOICES[brandVoice] || BRAND_VOICES.friendly;
  const rules = PLATFORM_RULES[platform];
  if (!rules) throw new Error(`no caption rules for ${platform}`);
  return { name, summary, voice, rules, platform };
}

/** Step 2: render a spec into a caption that respects the platform's rules. Deterministic (no AI, no cost). */
export function renderCaption(spec) {
  const { name, summary, voice, rules } = spec;
  const tags = pickHashtags(name, summary, rules.hashtagCount);
  const emoji = EMOJI_POOL.slice(0, rules.emoji).join(" ");
  const hook = `${voice.opener} ${name}${emoji ? " " + emoji : ""}`;
  const parts = { hook, body: summary, cta: rules.callToAction || voice.closer, hashtags: tags.join(" ") };

  if (rules.hashtagPlacement === "inline-end") {
    // X: hook + (trimmed) body + inline tags, hard-capped at maxChars
    const tail = parts.hashtags ? " " + parts.hashtags : "";
    const room = rules.maxChars - hook.length - 2 - tail.length;
    return `${hook}\n${shorten(summary, Math.max(room, 0))}${tail}`.slice(0, rules.maxChars);
  }
  const body = rules.structure
    .map((k) => parts[k])
    .filter(Boolean)
    .join("\n\n");
  return shorten(body, rules.maxChars);
}

export function composeCaption(input, platform) {
  return renderCaption(buildCaptionSpec(input, platform));
}

export function composeAll(input, platforms) {
  return Object.fromEntries(platforms.map((p) => [p, composeCaption(input, p)]));
}
