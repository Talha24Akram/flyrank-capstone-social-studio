import sharp from "sharp";

export const VARIANTS = {
  instagram: { width: 1080, height: 1080 },
  x: { width: 1600, height: 900 },
};
// The subject must sit inside the middle (1 - 2*margin) of the output so platform UI overlays never cover it.
export const SAFE_MARGIN = 0.1;

/**
 * subject = fractions of the source image {x,y,w,h} (0..1).
 * 1) crop the largest window with the target aspect ratio, centred on the subject and clamped to the image;
 * 2) if the subject would still land outside the safe zone, fall back to "contain" on a blurred copy of
 *    the image, which keeps the whole picture visible.
 * Returns the PNG/JPEG buffer plus the subject rectangle in output pixels (used by tests and evidence).
 */
export async function makeVariant(input, platform, subject) {
  const spec = VARIANTS[platform];
  if (!spec) throw new Error(`unknown platform ${platform}`);
  const img = sharp(input).rotate();
  const { width: W, height: H } = await img.metadata();
  const target = spec.width / spec.height;

  let cw, ch;
  if (W / H > target) { ch = H; cw = Math.round(H * target); } else { cw = W; ch = Math.round(W / target); }
  const sx = subject.x * W, sy = subject.y * H, sw = subject.w * W, sh = subject.h * H;
  const cx = sx + sw / 2, cy = sy + sh / 2;
  const left = Math.round(Math.min(Math.max(cx - cw / 2, 0), W - cw));
  const top = Math.round(Math.min(Math.max(cy - ch / 2, 0), H - ch));

  const fits = (l, t, w, h) => {
    const rx = (sx - l) / w, ry = (sy - t) / h, rw = sw / w, rh = sh / h;
    return rx >= SAFE_MARGIN && ry >= SAFE_MARGIN && rx + rw <= 1 - SAFE_MARGIN && ry + rh <= 1 - SAFE_MARGIN;
  };

  let buffer, rect, mode;
  if (fits(left, top, cw, ch)) {
    mode = "crop";
    buffer = await sharp(input).rotate().extract({ left, top, width: cw, height: ch })
      .resize(spec.width, spec.height).jpeg({ quality: 88 }).toBuffer();
    const k = spec.width / cw;
    rect = { x: (sx - left) * k, y: (sy - top) * k, w: sw * k, h: sh * k };
  } else {
    mode = "contain";
    const bg = await sharp(input).rotate().resize(spec.width, spec.height, { fit: "cover" }).blur(30).toBuffer();
    const fg = await sharp(input).rotate().resize(spec.width, spec.height, { fit: "inside" }).toBuffer({ resolveWithObject: true });
    const ox = Math.round((spec.width - fg.info.width) / 2), oy = Math.round((spec.height - fg.info.height) / 2);
    buffer = await sharp(bg).composite([{ input: fg.data, left: ox, top: oy }]).jpeg({ quality: 88 }).toBuffer();
    const k = fg.info.width / W;
    rect = { x: ox + sx * k, y: oy + sy * k, w: sw * k, h: sh * k };
  }
  const inSafe = rect.x >= spec.width * SAFE_MARGIN - 1 && rect.y >= spec.height * SAFE_MARGIN - 1 &&
    rect.x + rect.w <= spec.width * (1 - SAFE_MARGIN) + 1 && rect.y + rect.h <= spec.height * (1 - SAFE_MARGIN) + 1;
  return { buffer, width: spec.width, height: spec.height, mode, subjectRect: rect, subjectInSafeZone: inSafe };
}

export async function makeAllVariants(input, subject, platforms = Object.keys(VARIANTS)) {
  const out = {};
  for (const p of platforms) out[p] = await makeVariant(input, p, subject);
  return out;
}

// A generated sample hero (3:2 landscape, subject off-centre) so the demo needs no uploads.
export async function sampleHero() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#f97316"/></linearGradient></defs>
    <rect width="2400" height="1600" fill="url(#g)"/>
    <circle cx="1700" cy="800" r="330" fill="#fde68a"/><circle cx="1700" cy="800" r="190" fill="#ef4444"/>
    <text x="1700" y="1340" font-size="96" text-anchor="middle" fill="white" font-family="sans-serif">Studio Launch</text></svg>`;
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
  // subject = the sun disc: centre (1700,800) r 330 in a 2400x1600 canvas
  return { buffer, subject: { x: 1370 / 2400, y: 470 / 1600, w: 660 / 2400, h: 660 / 1600 } };
}
