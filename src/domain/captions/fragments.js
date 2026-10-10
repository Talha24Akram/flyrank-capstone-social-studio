// Shared prompt/caption building blocks. Platforms differ only in their RULES; the brand voice and the
// content summary are written once and reused. (Modelled on a config-driven social-prompts approach:
// no per-platform copy-pasted prompt strings.)
export const BRAND_VOICES = {
  friendly: { adjectives: ["warm", "upbeat", "plain-spoken"], opener: "Big news:", closer: "We can't wait to hear what you think." },
  professional: { adjectives: ["clear", "confident", "concise"], opener: "Announcing:", closer: "Learn more at the link." },
  playful: { adjectives: ["cheeky", "energetic", "witty"], opener: "Psst, guess what:", closer: "Come hang out with us." },
};

export const PLATFORM_RULES = {
  instagram: {
    maxChars: 2200, hashtagCount: 5, hashtagPlacement: "block-after-body", emoji: 2, callToAction: "Tap the link in bio.",
    structure: ["hook", "body", "cta", "hashtags"],
  },
  x: {
    maxChars: 280, hashtagCount: 2, hashtagPlacement: "inline-end", emoji: 0, callToAction: "",
    structure: ["hook", "body", "hashtags"],
  },
};

export const EMOJI_POOL = ["✨", "🚀", "🎉", "🔥"];
