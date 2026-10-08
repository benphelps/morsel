// The moon's phase from the date alone (no data source needed), for icons
// that show tonight's moon.

const DAY = 86_400_000;
/** The mean time from one new moon to the next. */
const SYNODIC = 29.530588853 * DAY;
/** A known new moon (6 January 2000, 18:14 UTC). */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** Where the moon is in its cycle at `epochMs`, 0 to 1: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. Good to within a day or so. */
export function moonPhase(epochMs: number): number {
  const k = ((epochMs - NEW_MOON) % SYNODIC) / SYNODIC;
  return k < 0 ? k + 1 : k;
}

/** Icons are drawn for this many phases a cycle (about every 12 hours), so each one is built once. */
export const MOON_STEPS = 60;

/** The phase step for `epochMs`, 0 to MOON_STEPS - 1. */
export function moonStep(epochMs: number): number {
  return Math.round(moonPhase(epochMs) * MOON_STEPS) % MOON_STEPS;
}

/**
 * Whether a point on the moon's face is sunlit at `phase`: x and y run from -1
 * to 1 across the disc (y down). Seen from the northern hemisphere: it waxes
 * from the right.
 */
export function sunlit(phase: number, x: number, y: number): boolean {
  // The terminator is half an ellipse, its width set by the phase.
  const edge = Math.cos(2 * Math.PI * phase) * Math.sqrt(Math.max(0, 1 - y * y));
  return phase < 0.5 ? x > edge : x < -edge;
}

/**
 * How a pixel of a moon icon looks at `phase`: (px, py) is the pixel's centre
 * and the disc is centred on (cx, cy) with radius r. "M" sunlit, "m" partly
 * (along the terminator, so thin crescents stay whole), "S" dark, null off the disc.
 */
export function moonPixel(phase: number, cx: number, cy: number, r: number, px: number, py: number): "M" | "m" | "S" | null {
  if (Math.hypot(px - cx, py - cy) > r) return null;
  // Sample the pixel 4×4, counting only the samples on the disc.
  let on = 0;
  let lit = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const [x, y] = [(px - 0.375 + i / 4 - cx) / r, (py - 0.375 + j / 4 - cy) / r];
      if (x * x + y * y > 1) continue;
      on++;
      if (sunlit(phase, x, y)) lit++;
    }
  return lit >= on * 0.6 ? "M" : lit >= on * 0.2 ? "m" : "S";
}
