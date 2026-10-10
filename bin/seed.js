// Seed: connect the two demo accounts (OAuth code exchange against the platform) and create one demo campaign.
import { assertSecrets, loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";

const cfg = loadConfig();
assertSecrets(cfg);
for (let i = 0; ; i++) {
  try { if ((await fetch(cfg.platformUrl + "/health")).ok) break; } catch { /* not up yet */ }
  if (i > 40) { console.error(`platform not reachable at ${cfg.platformUrl}; start it with \`npm start\``); process.exit(1); }
  await new Promise((r) => setTimeout(r, 500));
}
const ctx = createContext(cfg);
for (const p of ["instagram", "x"]) await ctx.accountService.connect(p);
const existing = ctx.campaignService.list(1, 0)[0];
if (!existing) {
  const { campaign } = await ctx.campaignService.create(
    { name: "Studio Launch", summary: "Our new design studio opens its doors with a week of free workshops for local makers and teams.", brandVoice: "friendly", platforms: ["instagram", "x"] },
    { idempotencyKey: "seed-demo-campaign" },
  );
  console.log("seeded campaign", campaign.id);
}
console.log("seed done: accounts connected =", ctx.accountService.list().map((a) => a.platform).join(", "));
