// Double-resolution icons, drawn with a tiny raster toolkit (discs, strokes,
// polygons) instead of pixel-doubling, so curves and shading get real detail.
// Used automatically when an icon element's scale is 2 or 4.
import { getIcon, ICONS, PHASED, type Icon } from "./icons";
import { MOON_STEPS, moonPixel, moonStep } from "./moon";

const PAL: Record<string, string> = {
  Y: "#ffc21a", // sun
  O: "#ff8a1f", // sun shade
  W: "#f4f7fb", // cloud
  G: "#aab6c4", // cloud shade / grey
  D: "#6c7a8a", // dark grey
  K: "#48525e", // storm shade
  B: "#3aa0ff", // rain
  b: "#1f6fd6", // rain shade
  C: "#a8e4ff", // ice
  R: "#ff4040", // red
  r: "#c0282e", // red shade
  P: "#ff9ec9", // highlight pink
  N: "#32d46a", // green
  n: "#1f9a4a", // green shade
  M: "#f1e6b8", // moon
  m: "#c4b582", // moon shade
  S: "#3c3f4a", // the moon's dark side
};

/** A drawing surface of palette characters; "." is clear. Coordinates are continuous, pixels are centred at +0.5. */
class Pix {
  px: string[];
  constructor(
    public w: number,
    public h: number,
  ) {
    this.px = new Array(w * h).fill(".");
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : ".";
  }
  set(x: number, y: number, c: string) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  each(fn: (x: number, y: number, cx: number, cy: number) => string | void) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = fn(x, y, x + 0.5, y + 0.5);
        if (c) this.set(x, y, c);
      }
    return this;
  }
  disc(cx: number, cy: number, r: number, c: string) {
    return this.each((_x, _y, px, py) => (Math.hypot(px - cx, py - cy) <= r ? c : undefined));
  }
  /** A stroke of width t between two points, with round ends. */
  seg(x0: number, y0: number, x1: number, y1: number, t: number, c: string) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    return this.each((_x, _y, px, py) => {
      const k = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
      return Math.hypot(px - (x0 + k * dx), py - (y0 + k * dy)) <= t / 2 ? c : undefined;
    });
  }
  poly(pts: [number, number][], c: string) {
    return this.each((_x, _y, px, py) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside ? c : undefined;
    });
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: string) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
    return this;
  }
  /** Recolours filled pixels matching `pred`. */
  shade(pred: (x: number, y: number, c: string) => boolean, c: string) {
    return this.each((x, y) => {
      const cur = this.get(x, y);
      return cur !== "." && pred(x, y, cur) ? c : undefined;
    });
  }
  /** Draws another icon's pixels on top at (dx, dy). */
  stamp(icon: Pix, dx: number, dy: number) {
    for (let y = 0; y < icon.h; y++)
      for (let x = 0; x < icon.w; x++) {
        const c = icon.get(x, y);
        if (c !== ".") this.set(x + dx, y + dy, c);
      }
    return this;
  }
  recolor(map: Record<string, string>) {
    const out = new Pix(this.w, this.h);
    out.px = this.px.map((c) => map[c] ?? c);
    return out;
  }
  toIcon(): Icon {
    // Pixels are palette letters, or raw #hex colours carried over from 1× icons.
    return { w: this.w, h: this.h, px: this.px.map((c) => (c === "." ? null : PAL[c] ?? (c.startsWith("#") ? c : null))) };
  }
}

const HEX_TO_CHAR: Record<string, string> = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [v, k]));

/**
 * Scale2x (EPX): doubles pixel art while rounding off stair-steps, so a 1×
 * silhouette keeps its character at 2× without looking blocky.
 */
function scale2x(icon: Icon): Pix {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= icon.w || y >= icon.h ? null : icon.px[y * icon.w + x]);
  const out = new Pix(icon.w * 2, icon.h * 2);
  const ch = (c: string | null) => (c ? HEX_TO_CHAR[c] ?? c : ".");
  for (let y = 0; y < icon.h; y++)
    for (let x = 0; x < icon.w; x++) {
      const P = at(x, y);
      const A = at(x, y - 1);
      const B = at(x + 1, y);
      const C = at(x - 1, y);
      const D = at(x, y + 1);
      out.set(x * 2, y * 2, ch(C === A && C !== D && A !== B ? A : P));
      out.set(x * 2 + 1, y * 2, ch(A === B && A !== C && B !== D ? B : P));
      out.set(x * 2, y * 2 + 1, ch(D === C && D !== B && C !== A ? C : P));
      out.set(x * 2 + 1, y * 2 + 1, ch(B === D && B !== A && D !== C ? D : P));
    }
  return out;
}

/** Nearest-neighbour doubling, for pixel-art sprites that should stay chunky. */
function doubled(icon: Icon): Icon {
  const px: (string | null)[] = [];
  for (let y = 0; y < icon.h * 2; y++) for (let x = 0; x < icon.w * 2; x++) px.push(icon.px[(y >> 1) * icon.w + (x >> 1)]);
  return { w: icon.w * 2, h: icon.h * 2, px };
}

/* ---------------- weather parts ---------------- */

function sun() {
  const p = new Pix(24, 24).disc(12, 12, 6.2, "Y");
  // Warm shade around the lower-right rim.
  p.shade((x, y) => Math.hypot(x + 0.5 - 12, y + 0.5 - 12) > 4.4 && x + y > 25, "O");
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    p.seg(12 + c * 8.6, 12 + s * 8.6, 12 + c * 11, 12 + s * 11, 2, "Y");
  }
  return p;
}

/** A crescent, or given a phase (see moonPhase), the moon then: its sunlit part, and the rest dimly. */
function moon(phase?: number) {
  const p = new Pix(22, 22).each((_x, _y, px, py) => {
    if (phase !== undefined) return moonPixel(phase, 11, 11, 10.4, px, py) ?? undefined;
    return Math.hypot(px - 11, py - 11) > 10.4 || Math.hypot(px - 16.2, py - 6.6) <= 8.6 ? undefined : "M";
  });
  // Shade the sunlit outer rim on the lower left, plus a few craters.
  const lit = (c: string) => c === "M";
  p.shade((x, y, c) => lit(c) && Math.hypot(x + 0.5 - 11, y + 0.5 - 11) > 8.9 && y > 9, "m");
  p.shade((x, y, c) => lit(c) && Math.hypot(x + 0.5 - 6, y + 0.5 - 13) <= 1.3, "m");
  p.shade((x, y, c) => lit(c) && Math.hypot(x + 0.5 - 10.5, y + 0.5 - 17.5) <= 1, "m");
  p.shade((x, y, c) => lit(c) && Math.hypot(x + 0.5 - 4.5, y + 0.5 - 8) <= 0.8, "m");
  return p;
}

/** The moon icons at 2×, built from the moon at a phase, as PHASED does at 1×. */
const PHASED_2X: Record<keyof typeof PHASED, (moon: Pix) => Pix> = {
  moon: (m) => m,
  "cloud-moon": (m) => new Pix(34, 24).stamp(m, 0, 0).stamp(cloud(), 6, 10),
};

function cloud() {
  // The 1× cloud's puffy silhouette, smoothed to 2×, with a softer two-step underside.
  const p = scale2x(ICONS.cloud);
  p.shade((_x, y) => y >= 11, "G");
  p.shade((x, y) => y === 10 && p.get(x, y + 1) !== "." && (x < 4 || x > 22), "G");
  return p;
}

const greyCloud = () => cloud().recolor({ W: "G", G: "D" });
const stormCloud = () => cloud().recolor({ W: "D", G: "K" });

function rainDrops(w: number) {
  const p = new Pix(w, 8);
  for (const [x, y] of [
    [6, 0],
    [14, 0],
    [22, 0],
    [3, 4],
    [11, 4],
    [19, 4],
  ]) {
    p.seg(x + 0.5, y + 0.5, x - 1.5, y + 3.5, 1.3, "B");
    p.set(x, y, "C");
  }
  return p;
}

function drizzleDrops(w: number) {
  const p = new Pix(w, 7);
  for (const [x, y] of [
    [5, 0],
    [13, 0],
    [21, 0],
    [9, 4],
    [17, 4],
  ])
    p.rect(x, y, x + 1, y + 1, "C");
  return p;
}

function flake(p: Pix, cx: number, cy: number) {
  p.seg(cx - 2.5, cy, cx + 2.5, cy, 1, "C");
  p.seg(cx, cy - 2.5, cx, cy + 2.5, 1, "C");
  p.seg(cx - 1.7, cy - 1.7, cx + 1.7, cy + 1.7, 1, "W");
  p.seg(cx - 1.7, cy + 1.7, cx + 1.7, cy - 1.7, 1, "W");
  p.set(Math.floor(cx), Math.floor(cy), "W");
}

function bolt() {
  const p = new Pix(12, 16).poly(
    [
      [6, 0],
      [12, 0],
      [8, 6],
      [11.5, 6],
      [2, 16],
      [4.5, 8.5],
      [1, 8.5],
    ],
    "Y",
  );
  p.shade((x, y) => p.get(x + 1, y) === "." || p.get(x, y + 1) === ".", "O");
  return p;
}

function fogLines() {
  const p = new Pix(28, 14);
  const rows: [number, number, number][] = [
    [0, 2, 21],
    [4, 6, 27],
    [8, 0, 21],
    [12, 4, 25],
  ];
  for (const [y, x0, x1] of rows) {
    p.seg(x0 + 1, y + 1, x1, y + 1, 2, "G");
  }
  return p;
}

function windLines() {
  const p = new Pix(28, 16);
  // Three gusts, each ending in a curl.
  p.seg(1, 5, 17, 5, 2, "W");
  p.each((_x, _y, px, py) => {
    const d = Math.hypot(px - 17, py - 2.2);
    return d >= 1.8 && d <= 3.6 && !(px < 17 && py < 2.2) ? "W" : undefined;
  });
  p.seg(1, 10, 23, 10, 2, "W");
  p.each((_x, _y, px, py) => {
    const d = Math.hypot(px - 23, py - 7.2);
    return d >= 1.8 && d <= 3.6 && !(px < 23 && py < 7.2) ? "W" : undefined;
  });
  p.seg(5, 14.5, 15, 14.5, 2, "G");
  return p;
}

function weather(base: Pix, under: Pix | null, underY: number) {
  const p = new Pix(28, under ? underY + under.h : base.h).stamp(base, 0, 0);
  if (under) p.stamp(under, 0, underY);
  return p;
}

/* ---------------- general icons ---------------- */

function heart() {
  const p = new Pix(16, 14).each((_x, _y, px, py) => {
    // The heart curve spans x ±1.14, y -1…1.25; fit it to the 16×14 grid.
    const x = (px - 8) / 6.6;
    const y = (7.75 - py) / 5.9;
    return Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y <= 0 ? "R" : undefined;
  });
  p.shade((x, y) => p.get(x + 1, y) === "." || p.get(x, y + 1) === ".", "r");
  p.rect(3, 3, 4, 4, "P");
  p.set(5, 3, "P");
  return p;
}

function star() {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 4.3 : 9.6;
    pts.push([9 + Math.cos(a) * r, 9.8 + Math.sin(a) * r]);
  }
  const p = new Pix(18, 18).poly(pts, "Y");
  p.shade((x, y) => x >= 9 && (p.get(x + 1, y) === "." || p.get(x, y + 1) === "."), "O");
  return p;
}

function droplet() {
  const p = new Pix(12, 16).disc(6, 10, 5.2, "B").poly(
    [
      [6, 0],
      [10.6, 8],
      [1.4, 8],
    ],
    "B",
  );
  p.shade((x, y) => x >= 6 && Math.hypot(x + 0.5 - 6, y + 0.5 - 10) > 3.4 && y > 6, "b");
  p.rect(3, 9, 3, 11, "C");
  return p;
}

function clock() {
  const p = new Pix(18, 18).each((_x, _y, px, py) => {
    const d = Math.hypot(px - 9, py - 9);
    return d <= 8.6 && d >= 6.9 ? "W" : undefined;
  });
  p.seg(9, 9, 9, 4, 1.6, "W");
  p.seg(9, 9, 12.5, 11, 1.6, "Y");
  for (const [x, y] of [
    [8, 2],
    [15, 8],
    [8, 15],
    [2, 8],
  ])
    p.rect(x, y, x + 1, y + 1, "G");
  return p;
}

function check() {
  return new Pix(16, 12).seg(1.5, 6, 6, 10.5, 2.6, "N").seg(6, 10.5, 14.5, 1.5, 2.6, "N");
}

function cross() {
  return new Pix(14, 14).seg(1.5, 1.5, 12.5, 12.5, 2.6, "R").seg(12.5, 1.5, 1.5, 12.5, 2.6, "R");
}

function arrowUp() {
  return new Pix(14, 14)
    .poly(
      [
        [7, 0],
        [14, 7],
        [10, 7],
        [10, 14],
        [4, 14],
        [4, 7],
        [0, 7],
      ],
      "W",
    )
    .shade((x) => x >= 7, "W");
}

function rotate(p: Pix): Pix {
  const out = new Pix(p.h, p.w);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) out.set(p.h - 1 - y, x, p.get(x, y));
  return out;
}

function thermometer() {
  const p = new Pix(10, 20);
  p.each((_x, _y, px, py) => {
    const inTube = px >= 2.5 && px <= 7.5 && py >= 0.5 && py <= 14;
    const inBulb = Math.hypot(px - 5, py - 15.5) <= 4.4;
    return inTube || inBulb ? "W" : undefined;
  });
  p.each((_x, _y, px, py) => {
    const tube = px >= 4 && px <= 6 && py >= 2 && py <= 14;
    const tubeTop = Math.hypot(px - 5, py - 2) <= 1;
    const bulb = Math.hypot(px - 5, py - 15.5) <= 2.9;
    if (bulb || (tube && py >= 7)) return "R";
    if (tube || tubeTop) return "D";
  });
  p.shade((x, y) => p.get(x, y) === "R" && x >= 6 && y >= 14, "r");
  return p;
}

function bell() {
  const p = new Pix(18, 18);
  p.poly(
    [
      [9, 1.5],
      [12.5, 3],
      [13.8, 7],
      [14.2, 11],
      [16.5, 13.5],
      [1.5, 13.5],
      [3.8, 11],
      [4.2, 7],
      [5.5, 3],
    ],
    "Y",
  );
  p.rect(8, 0, 9, 1, "Y");
  p.disc(9, 15.6, 1.9, "O");
  p.shade((x, y) => x >= 11 && y < 13 && p.get(x + 1, y) === ".", "O");
  p.rect(1, 13, 16, 13, "O");
  return p;
}

function music() {
  const p = new Pix(16, 16);
  p.rect(5, 1, 14, 3, "W");
  p.rect(5, 1, 6, 12, "W");
  p.rect(13, 1, 14, 10, "W");
  p.disc(3.8, 13, 2.9, "W");
  p.disc(11.8, 11, 2.9, "W");
  return p;
}

function mail() {
  const p = new Pix(18, 14).rect(0, 0, 17, 13, "W");
  p.rect(1, 1, 16, 12, ".");
  p.seg(1, 1, 9, 7.5, 1.4, "W").seg(17, 1, 9, 7.5, 1.4, "W");
  p.shade((_x, y) => y === 13, "G");
  return p;
}

function home() {
  const p = new Pix(18, 16);
  p.poly(
    [
      [9, 0],
      [18, 8],
      [0, 8],
    ],
    "R",
  );
  p.rect(2, 8, 15, 15, "W");
  p.rect(7, 10, 10, 15, "O");
  p.rect(12, 10, 13, 11, "B");
  p.shade((_x, y) => y === 7, "r");
  p.rect(12, 1, 13, 4, "D");
  return p;
}

function calendar() {
  const p = new Pix(18, 18).rect(0, 2, 17, 17, "W");
  p.rect(0, 2, 17, 5, "R");
  p.rect(4, 0, 5, 3, "G");
  p.rect(12, 0, 13, 3, "G");
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) p.rect(2 + col * 4, 8 + row * 3, 3 + col * 4, 9 + row * 3, row === 1 && col === 2 ? "R" : "D");
  return p;
}

function news() {
  const p = new Pix(20, 16).rect(0, 0, 17, 15, "W").rect(18, 3, 19, 15, "G");
  p.rect(2, 2, 15, 3, "D");
  p.rect(2, 6, 7, 10, "G");
  for (const y of [6, 8, 10, 12]) p.rect(9, y, 15, y, "D");
  p.rect(2, 12, 7, 12, "D");
  return p;
}

function trend(up: boolean) {
  const p = new Pix(10, 6).poly(
    up
      ? [
          [5, 0],
          [10, 6],
          [0, 6],
        ]
      : [
          [0, 0],
          [10, 0],
          [5, 6],
        ],
    up ? "N" : "R",
  );
  return p;
}

const arrow = arrowUp();

const BUILT: Record<string, Pix> = {
  sun: sun(),
  moon: moon(),
  cloud: cloud(),
  "cloud-sun": new Pix(34, 24).stamp(sun(), 0, 0).stamp(cloud(), 6, 10),
  "cloud-moon": new Pix(34, 24).stamp(moon(), 0, 0).stamp(cloud(), 6, 10),
  crescent: moon(),
  overcast: new Pix(32, 20).stamp(greyCloud(), 4, 0).stamp(cloud(), 0, 5),
  rain: weather(greyCloud(), rainDrops(28), 15),
  drizzle: weather(cloud(), drizzleDrops(28), 16),
  snow: (() => {
    const p = weather(cloud(), null, 0);
    const out = new Pix(28, 22).stamp(p, 0, 0);
    flake(out, 6.5, 18.5);
    flake(out, 14.5, 18.5);
    flake(out, 22.5, 18.5);
    return out;
  })(),
  thunder: new Pix(28, 25).stamp(stormCloud(), 0, 0).stamp(bolt(), 9, 9),
  fog: fogLines(),
  wind: windLines(),
  heart: heart(),
  star: star(),
  bell: bell(),
  check: check(),
  cross: cross(),
  "arrow-up": arrow,
  "arrow-right": rotate(arrow),
  "arrow-down": rotate(rotate(arrow)),
  "arrow-left": rotate(rotate(rotate(arrow))),
  "trend-up": trend(true),
  "trend-down": trend(false),
  droplet: droplet(),
  thermometer: thermometer(),
  music: music(),
  mail: mail(),
  home: home(),
  calendar: calendar(),
  clock: clock(),
  news: news(),
};

/** Double-resolution versions of every icon in ICONS. Pixel-art sprites are doubled as-is. */
export const ICONS_2X: Record<string, Icon> = Object.fromEntries(
  Object.keys(ICONS).map((name) => [name, BUILT[name]?.toIcon() ?? doubled(ICONS[name])]),
);

const phased = new Map<string, Icon>();

/** The 2× art for `name` as it looks at `at` (epoch ms), like getIcon. */
export function icon2xAt(name: string, at = Date.now()): Icon | null {
  const n = name.trim();
  const make = PHASED_2X[n];
  if (!make) return ICONS_2X[n] ?? null;
  const step = moonStep(at);
  const key = `${n}:${step}`;
  let icon = phased.get(key);
  if (!icon) phased.set(key, (icon = make(moon(step / MOON_STEPS)).toIcon()));
  return icon;
}

/**
 * The art and pixel multiplier to draw `name` at `scale`, as it looks at `at`
 * (the moon icons show its phase). Even scales use the detailed 2× art
 * (unless `blocky`); odd scales double the 1× pixels.
 */
export function iconForScale(name: string, scale: number, blocky = false, at = Date.now()): { icon: Icon; k: number } | null {
  const k = Math.max(1, Math.round(scale));
  const base = getIcon(name, at);
  if (!base) return null;
  if (!blocky && k % 2 === 0) {
    const hi = icon2xAt(name, at);
    if (hi) return { icon: hi, k: k / 2 };
  }
  return { icon: base, k };
}
