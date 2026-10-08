import { resolveTemplate } from "../../shared/bindings";
import { parseColor } from "../../shared/color";
import type { Painter } from "../../shared/painter";
import type { AnimState, ElementBase } from "../../shared/types";
import type { ElementDef } from "../types";

// Ambient effects: rain, snow, stars, drifting clouds and an overcast sky. Every particle's position is a
// formula of time and a seed (no simulation), so any frame can be drawn on its
// own and the editor matches the device pixel for pixel. The seed is mixed with
// which showing of the slide it is, so each showing has its own arrangement.

export type EffectKind = "rain" | "snow" | "stars" | "clouds" | "overcast";
export const EFFECT_KINDS: EffectKind[] = ["rain", "snow", "stars", "clouds", "overcast"];

export interface EffectElement extends ElementBase {
  type: "effect";
  /** "rain", "snow", "stars", "clouds", "overcast" or "none", or a binding such as {{weather.effect}}. */
  effect: string;
  /** How many particles or clouds, 0–100 (50 is a fair shower); overcast, how thick. */
  density: number;
  /** Speed multiplier (1 = natural). */
  speed: number;
  /** Sideways drift, -100 (left) to 100 (right). */
  wind: number;
  /** 1–3: longer streaks, bigger flakes, brighter stars, bigger clouds. */
  size: number;
  /** Which random layouts; change it for a different set. Each showing of the slide mixes in its number (see showingSeed). */
  seed: number;
  /** Draw every lit pixel in state.color instead of the effect's own colours. */
  tint: boolean;
  /** Move the particles only every this many ms (0 = every frame): fewer changing frames, smaller clips. */
  stepMs: number;
}

/** A repeatable random number in [0, 1) for particle i. */
function rand(seed: number, i: number, salt: number) {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * The seed for this showing: the element's own, mixed with the slide's showing
 * number ($play) and, in a rotator, the item's ({{index}}). So every showing
 * looks different, while any render of the same one (the device, its mirror,
 * the deck preview) matches. The first showing of a slide uses the seed as is.
 */
export function showingSeed(seed: number, scope: Record<string, unknown>): number {
  const play = Number(scope.$play) || 0;
  const item = Number(scope.index) || 0;
  return play || item ? Math.floor(rand(seed, play, 20 + item) * 4294967296) : seed;
}

/** Which effect to draw right now: its own, or what its binding says. */
export function effectKind(el: EffectElement, scope: Record<string, unknown>): EffectKind | null {
  const v = resolveTemplate(el.effect, scope).trim().toLowerCase();
  return (EFFECT_KINDS as string[]).includes(v) ? (v as EffectKind) : null;
}

const NATURAL: Record<EffectKind, number[][]> = {
  rain: [[127, 178, 255]],
  snow: [[255, 255, 255]],
  // Mostly white, some pale blue, a few warm.
  stars: [[255, 255, 255], [255, 255, 255], [255, 255, 255], [174, 203, 255], [255, 224, 168]],
  // Clouds and overcast shade between these two (see cloudShade).
  clouds: [[236, 241, 247]],
  overcast: [[150, 160, 174]],
};

/** A cloud's colour at `light` (0 its underside, 1 its sunlit top): its own greys, or the tint darkened below. */
function cloudShade(el: EffectElement, s: AnimState, kind: "clouds" | "overcast", light: number) {
  const [top, under] = el.tint
    ? [parseColor(s.color), parseColor(s.color).map((c) => c * 0.55)]
    : kind === "clouds"
      ? [NATURAL.clouds[0], [138, 150, 166]]
      : [NATURAL.overcast[0], [70, 78, 92]];
  return top.map((c, i) => Math.round(under[i] + (c - under[i]) * light));
}

/** Particle count for the box: `perPanel` at density 50 on the full 64×32. */
const count = (s: AnimState, density: number, perPanel: number) => Math.round(((s.w * s.h) / 2048) * perPanel * (Math.max(0, density) / 50));

function rain(p: Painter, el: EffectElement, s: AnimState, t: number, rgb: (i: number) => number[]) {
  const slope = el.wind / 100; // sideways px per px fallen
  const len = 1 + 2 * Math.max(1, Math.min(3, el.size));
  for (let i = 0, n = count(s, el.density, 40); i < n; i++) {
    const v = (45 + 30 * rand(el.seed, i, 1)) * el.speed; // px/s
    const l = len - Math.round(rand(el.seed, i, 2)); // a little variety
    const span = s.h + l;
    const fallen = (v * t) / 1000;
    const y = mod(rand(el.seed, i, 3) * span + fallen, span) - l;
    const x = mod(rand(el.seed, i, 4) * s.w + slope * fallen, s.w);
    const depth = 0.55 + 0.45 * rand(el.seed, i, 5); // nearer drops are brighter
    const [r, g, b] = rgb(i);
    for (let k = 0; k < l; k++) p.px(s.x + Math.round(mod(x - slope * k, s.w)), s.y + Math.round(y - k), r, g, b, s.opacity * depth * (1 - (k / l) * 0.7));
  }
}

function snow(p: Painter, el: EffectElement, s: AnimState, t: number, rgb: (i: number) => number[]) {
  const slope = el.wind / 100;
  for (let i = 0, n = count(s, el.density, 45); i < n; i++) {
    const depth = rand(el.seed, i, 5);
    const v = (5 + 9 * depth) * el.speed; // nearer flakes fall faster
    const fallen = (v * t) / 1000;
    const span = s.h + 2;
    const y = mod(rand(el.seed, i, 3) * span + fallen, span) - 1;
    const sway = (0.8 + 1.4 * rand(el.seed, i, 6)) * Math.sin(2 * Math.PI * (t / (2200 + 1800 * rand(el.seed, i, 7)) + rand(el.seed, i, 8)));
    const x = mod(rand(el.seed, i, 4) * s.w + slope * fallen + sway, s.w);
    const big = el.size >= 2 && depth > (el.size >= 3 ? 0.45 : 0.7) ? 2 : 1;
    const [r, g, b] = rgb(i);
    const a = s.opacity * (0.5 + 0.5 * depth);
    for (let dy = 0; dy < big; dy++) for (let dx = 0; dx < big; dx++) p.px(s.x + Math.round(x) + dx, s.y + Math.round(y) + dy, r, g, b, a);
  }
}

function stars(p: Painter, el: EffectElement, s: AnimState, t: number, rgb: (i: number) => number[]) {
  const drift = (el.wind / 100) * 2 * el.speed; // px/s: a slow pan
  const size = Math.max(1, Math.min(3, el.size));
  for (let i = 0, n = count(s, el.density, 30); i < n; i++) {
    const x = s.x + Math.round(mod(rand(el.seed, i, 4) * s.w + (drift * t) / 1000, s.w));
    const y = s.y + Math.floor(rand(el.seed, i, 3) * s.h);
    const period = (1500 + 2500 * rand(el.seed, i, 1)) / Math.max(0.1, el.speed);
    const tw = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t / period + rand(el.seed, i, 2)));
    // Most twinkle; some glow steadily.
    const a = s.opacity * (rand(el.seed, i, 6) < 0.35 ? 0.45 + 0.2 * tw : 0.2 + 0.8 * tw * tw);
    const [r, g, b] = rgb(i);
    p.px(x, y, r, g, b, a);
    // A few bright ones get a faint cross at their peak.
    if (size >= 2 && rand(el.seed, i, 7) > (size >= 3 ? 0.8 : 0.9)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.px(x + dx, y + dy, r, g, b, a * 0.35);
  }
  // Now and then, a shooting star.
  if (el.density <= 0) return;
  const every = 7000 / Math.max(0.1, el.speed);
  const c = Math.floor(t / every);
  const start = c * every + rand(el.seed, c, 11) * every * 0.6;
  const dur = 700;
  if (t < start || t >= start + dur) return;
  const k = (t - start) / dur;
  const x0 = s.x + s.w * (0.35 + 0.65 * rand(el.seed, c, 12));
  const y0 = s.y + s.h * 0.35 * rand(el.seed, c, 13);
  const [r, g, b] = rgb(0);
  for (let j = 0; j < 5; j++) {
    const d = k * 40 - j * 1.4; // travelled, trailing
    if (d < 0) continue;
    p.px(Math.round(x0 - d), Math.round(y0 + d * 0.45), r, g, b, s.opacity * (1 - k) * (1 - j / 5));
  }
}

/**
 * Cumulus drifting with the wind: a hazy, slower layer far off, and nearer
 * clouds that are bigger, faster and solid, so they hide whatever is under
 * them (put the effect above a sun to have it come and go behind them). Each
 * is a row of puffs on a flat base with a puff or two piled on top, every puff
 * lit from the upper left. They move a whole pixel at a time, so a slow drift
 * adds few frames.
 */
function clouds(p: Painter, el: EffectElement, s: AnimState, t: number) {
  const size = Math.max(1, Math.min(3, el.size));
  const scale = 0.75 + 0.25 * size;
  const n = el.density > 0 ? Math.max(1, count(s, el.density, 6)) : 0;
  // Which way and how fast they go: the wind, or a gentle drift right with none.
  const dir = el.wind < 0 ? -1 : 1;
  const gust = 0.5 + Math.abs(el.wind) / 100;
  // Where the light comes from: up and a little left.
  const [lx, ly] = [-0.35, -0.94];
  // Farthest first, so nearer clouds cover them.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rand(el.seed, a, 5) - rand(el.seed, b, 5));
  for (const i of order) {
    const depth = rand(el.seed, i, 5);
    const r01 = (salt: number) => rand(el.seed, i, salt);
    const k = scale * (0.65 + 0.6 * depth);
    const w = (14 + 14 * r01(1)) * k;
    const h = (6 + 4 * r01(2)) * k;
    // Puffs along a flat base, small at the ends and each its own size, so the top is lumpy…
    const row = 3 + Math.floor(r01(6) * 3);
    const discs = Array.from({ length: row }, (_, j) => {
      const u = (j + 0.5) / row;
      const r = h * (0.28 + 0.27 * Math.sin(Math.PI * u) + 0.25 * rand(el.seed, i * 8 + j, 7));
      return { x: r * 0.8 + (w - r * 1.6) * u, y: -r * (0.5 + 0.25 * rand(el.seed, i * 8 + j, 8)), r };
    });
    // …and a puff or two piled on top, towards the middle.
    for (let j = 0, tops = 1 + Math.floor(r01(10) * 2); j < tops; j++) {
      const r = h * (0.32 + 0.18 * rand(el.seed, i * 8 + j, 11));
      discs.push({ x: w * (0.3 + 0.4 * rand(el.seed, i * 8 + j, 12)), y: -h * (0.55 + 0.25 * rand(el.seed, i * 8 + j, 13)), r });
    }
    const top = Math.floor(Math.min(...discs.map((d) => d.y - d.r)));
    // Its base, somewhere in the upper part of the sky, with its top always inside the box.
    const base = Math.round(1 - top + r01(3) * Math.max(0, s.h * 0.8 + top));
    const v = (1 + 3 * depth) * gust * el.speed * dir; // px/s
    const span = s.w + w + 2;
    const x0 = Math.round(mod(r01(4) * span + (v * t) / 1000, span) - w - 1);
    // Far clouds are thin and dim; near ones are solid.
    const a = s.opacity * Math.min(1, 0.45 + 0.75 * depth);
    const dim = 0.7 + 0.3 * depth;
    for (let y = top; y < 0; y++)
      for (let x = 0; x < Math.ceil(w); x++) {
        // The puff the pixel is deepest in: how deep (softening the edge), and which way its surface faces.
        let inside = 0;
        let face = 0;
        for (const d of discs) {
          const dx = x + 0.5 - d.x;
          const dy = y + 0.5 - d.y;
          const din = d.r - Math.hypot(dx, dy);
          if (din > inside) {
            inside = din;
            face = (dx * lx + dy * ly) / d.r;
          }
        }
        const edge = Math.min(1, inside / 0.9);
        if (edge < 0.15) continue;
        // Lit puffs, and a shadowed underside.
        const height = Math.min(1, (-y - 0.5) / Math.max(1, -top * 0.5));
        const light = Math.min(1, Math.max(0, 0.45 * height + 0.55 * (0.5 + 0.5 * face))) * dim;
        const [r, g, b] = cloudShade(el, s, "clouds", light);
        p.px(s.x + x0 + x, s.y + base + y, r, g, b, a * edge);
      }
  }
}

/** Smooth random values over a grid of `cell` px: the overcast's texture. */
function noise(seed: number, x: number, y: number, cell: number, salt: number) {
  const gx = x / cell;
  const gy = y / cell;
  const [ix, iy] = [Math.floor(gx), Math.floor(gy)];
  const [fx, fy] = [gx - ix, gy - iy];
  const at = (cx: number, cy: number) => rand(seed, (cx & 0xffff) * 65536 + (cy & 0xffff), salt);
  const ease = (f: number) => f * f * (3 - 2 * f);
  const [ex, ey] = [ease(fx), ease(fy)];
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * ex;
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * ex;
  return top + (bottom - top) * ey;
}

/**
 * A low grey sky: a rolling, uneven cloud deck, thickest at the top, drifting
 * with the wind a whole pixel at a time. Density sets how thick it is.
 */
function overcast(p: Painter, el: EffectElement, s: AnimState, t: number) {
  if (el.density <= 0) return;
  const thick = Math.min(1, 0.35 + el.density / 80);
  const cell = 6 + 3 * Math.max(1, Math.min(3, el.size));
  const dir = el.wind < 0 ? -1 : 1;
  const shift = Math.round(((0.6 + Math.abs(el.wind) / 40) * el.speed * dir * t) / 1000);
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const u = x - shift;
      const v = y * 1.6; // flattened: layers, not blobs
      const raw = 0.65 * noise(el.seed, u, v, cell * 1.8, 1) + 0.35 * noise(el.seed, u, v, cell * 0.8, 2);
      // Stretched, so the rolls stand out from the gaps between them.
      const k = Math.min(1, Math.max(0, (raw - 0.25) / 0.5));
      const n = k * k * (3 - 2 * k);
      const fall = 1 - 0.6 * (y / Math.max(1, s.h - 1)); // thinner toward the bottom
      const a = s.opacity * Math.min(1, thick * fall * (0.45 + 0.65 * n));
      const [r, g, b] = cloudShade(el, s, "overcast", n);
      p.px(s.x + x, s.y + y, r, g, b, a);
    }
}

export const effectElement: ElementDef<EffectElement> = {
  type: "effect",
  label: "Effect",
  group: "data",
  icon: "M4.5 2.5L3 6.5 M9.5 2.5L8 6.5 M7 9L5.5 13 M12 9l-1.5 4",
  create: () => ({
    effect: "rain",
    density: 50,
    speed: 1,
    wind: 15,
    size: 1,
    seed: Math.floor(Math.random() * 1e6),
    tint: false,
    stepMs: 0,
    state: { x: 0, y: 0, w: 64, h: 32, color: "#7fb2ff", opacity: 1 },
  }),
  draw(p, el, s, { t, scope }) {
    const kind = effectKind(el, scope);
    if (!kind || s.w <= 0 || s.h <= 0) return;
    const at = el.stepMs > 0 ? Math.floor(t / el.stepMs) * el.stepMs : t;
    const seed = showingSeed(el.seed, scope);
    if (seed !== el.seed) el = { ...el, seed };
    const own = NATURAL[kind];
    const tint = parseColor(s.color);
    const rgb = (i: number) => (el.tint ? tint : own[Math.floor(rand(el.seed, i, 9) * own.length)]);
    const box = p.box(s);
    if (kind === "rain") rain(box, el, s, at, rgb);
    else if (kind === "snow") snow(box, el, s, at, rgb);
    else if (kind === "stars") stars(box, el, s, at, rgb);
    else if (kind === "clouds") clouds(box, el, s, at);
    else overcast(box, el, s, at);
  },
  bindable: ["effect"],
};
