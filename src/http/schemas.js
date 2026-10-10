import { z } from "zod";

const fraction = z.number().min(0).max(1);
const subject = z.object({ x: fraction, y: fraction, w: fraction.refine((v) => v > 0, "w must be > 0"), h: fraction.refine((v) => v > 0, "h must be > 0") })
  .refine((s) => s.x + s.w <= 1 && s.y + s.h <= 1, "subject must lie inside the image");

// "2026-10-10T12:00:00Z" or epoch milliseconds -> epoch ms
const when = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const ms = typeof v === "number" ? v : Date.parse(v);
  if (!Number.isFinite(ms) || ms < 0) { ctx.addIssue({ code: "custom", message: "invalid date" }); return z.NEVER; }
  return ms;
});

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1000),
  brandVoice: z.enum(["friendly", "professional", "playful"]).default("friendly"),
  platforms: z.array(z.enum(["instagram", "x"])).min(1).max(2).default(["instagram", "x"]).transform((a) => [...new Set(a)]),
  imageBase64: z.string().min(16).max(14_000_000).optional(),
  subject: subject.optional(),
  scheduleAt: when.optional(),
}).strict();

export const scheduleSchema = z.object({ at: when }).strict();
export const advanceSchema = z.object({ seconds: z.number().finite().min(0).max(7 * 86400) }).strict();
export const idParam = /^cmp_[0-9a-f]{16}$/;
