// Readying small pictures (album art, favicons) for the LED panel. Shrinking
// softens them, and LEDs lose dark and mid tones (worst at low brightness),
// so: richer colour, a light sharpen to bring back edges, and lifted shadows,
// with anything near black kept fully off so dark backgrounds don't glow.
import type { Sharp } from "sharp";

/** Anything this close to black is left fully off. */
const BLACK_POINT = 10;
/** Below 1 lifts dark and mid tones. */
const SHADOW_LIFT = 0.85;
const TONE = Uint8Array.from({ length: 256 }, (_, v) => (v <= BLACK_POINT ? 0 : Math.round(255 * ((v - BLACK_POINT) / (255 - BLACK_POINT)) ** SHADOW_LIFT)));

/** Resizes (a single Lanczos step from the full-size source) and tunes for LEDs, returning RGBA pixels. */
export async function tunedPixels(img: Sharp, w: number, h: number, fit: "cover" | "contain", tune = true): Promise<Buffer> {
  let out = img.resize(w, h, { fit, background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" });
  if (tune) out = out.modulate({ saturation: 1.3 }).sharpen({ sigma: 0.6 });
  const raw = await out.ensureAlpha().raw().toBuffer();
  if (tune) for (let i = 0; i < raw.length; i += 4) (raw[i] = TONE[raw[i]]), (raw[i + 1] = TONE[raw[i + 1]]), (raw[i + 2] = TONE[raw[i + 2]]);
  return raw;
}
