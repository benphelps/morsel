// Hand-drawn pixel icons. Each is a grid of palette characters; "." is clear.
// Weather icons are layered from smaller parts so they stay consistent.
import { MOON_STEPS, moonPixel, moonStep } from "./moon";

const PALETTE: Record<string, string> = {
  Y: "#ffc21a", // sun yellow
  O: "#ff8a1f", // orange
  W: "#f4f7fb", // white
  G: "#aab6c4", // light grey
  D: "#6c7a8a", // dark grey
  B: "#3aa0ff", // blue
  C: "#a8e4ff", // ice
  R: "#ff4040", // red
  N: "#32d46a", // green
  M: "#f1e6b8", // moon
  m: "#c4b582", // moon shade
  S: "#3c3f4a", // the moon's dark side
  P: "#ff6fb5", // pink
  V: "#a67cff", // violet
};

export interface Icon {
  w: number;
  h: number;
  /** One palette colour or null per pixel. */
  px: (string | null)[];
}

function grid(rows: string[]): Icon {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const px: (string | null)[] = [];
  for (const r of rows) for (let x = 0; x < w; x++) px.push(PALETTE[r[x]] ?? null);
  return { w, h, px };
}

function layer(w: number, h: number, parts: [Icon, number, number][]): Icon {
  const px: (string | null)[] = new Array(w * h).fill(null);
  for (const [icon, dx, dy] of parts)
    for (let y = 0; y < icon.h; y++)
      for (let x = 0; x < icon.w; x++) {
        const c = icon.px[y * icon.w + x];
        const tx = x + dx;
        const ty = y + dy;
        if (c && tx >= 0 && ty >= 0 && tx < w && ty < h) px[ty * w + tx] = c;
      }
  return { w, h, px };
}

function fromFn(w: number, h: number, fn: (x: number, y: number) => string): Icon {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let r = "";
    for (let x = 0; x < w; x++) r += fn(x, y);
    rows.push(r);
  }
  return grid(rows);
}

function recolor(icon: Icon, map: Record<string, string>): Icon {
  const inv: Record<string, string> = {};
  for (const [from, to] of Object.entries(map)) inv[PALETTE[from]] = PALETTE[to];
  return { ...icon, px: icon.px.map((c) => (c && inv[c] ? inv[c] : c)) };
}

const rot90 = (i: Icon): Icon => {
  const px: (string | null)[] = [];
  for (let y = 0; y < i.w; y++) for (let x = 0; x < i.h; x++) px.push(i.px[(i.h - 1 - x) * i.w + y]);
  return { w: i.h, h: i.w, px };
};

/* ---------- weather parts ---------- */

const sun = grid([
  ".....Y.....",
  ".Y...Y...Y.",
  "..Y.....Y..",
  "....YYY....",
  "...YYYYY...",
  "YY.YYYYY.YY",
  "...YYYYY...",
  "....YYY....",
  "..Y.....Y..",
  ".Y...Y...Y.",
  ".....Y.....",
]);

const crescent = fromFn(11, 11, (x, y) => {
  const outer = Math.hypot(x + 0.5 - 5.5, y + 0.5 - 5.5) <= 5.3;
  const inner = Math.hypot(x + 0.5 - 8.2, y + 0.5 - 3.6) <= 4.4;
  return outer && !inner ? "M" : ".";
});

/** The moon at `phase` (see moonPhase): its sunlit part, and the rest dimly, so a new moon still shows. */
const moonAt = (phase: number) =>
  fromFn(11, 11, (x, y) => {
    return moonPixel(phase, 5.5, 5.5, 5.3, x + 0.5, y + 0.5) ?? ".";
  });

const cloud = grid([
  ".....WWW......",
  "....WWWWW.WW..",
  "..WWWWWWWWWWW.",
  ".WWWWWWWWWWWWW",
  "WWWWWWWWWWWWWW",
  "WWWWWWWWWWWWWW",
  ".GGGGGGGGGGGG.",
]);
const greyCloud = recolor(cloud, { W: "G", G: "D" });

const rainDrops = grid(["...B...B...B..", "..B...B...B...", "..............", ".B...B...B...."]);
const drizzleDrops = grid(["..C....C....C.", "..............", "....C....C...."]);
const snowFlakes = grid(["..C....C....C.", ".CCC..CCC..CCC", "..C....C....C."]);
const bolt = grid(["......YY", ".....YY.", "....YYYY", "......Y.", ".....Y..", "....Y..."]);

const fog = grid([
  ".GGGGGGGGGG...",
  "..............",
  "...GGGGGGGGGGG",
  "..............",
  "GGGGGGGGGGG...",
  "..............",
  "..GGGGGGGGGGG.",
]);

const wind = grid([
  "........WW....",
  "..........W...",
  "WWWWWWWWWW....",
  "..............",
  "WWWWWWWWWWWWW.",
  ".............W",
  "..WWWWWWWWWWW.",
]);

/* ---------- general icons ---------- */

const arrowUp = grid(["...W...", "..WWW..", ".WWWWW.", "WWWWWWW", "..WWW..", "..WWW..", "..WWW.."]);

export const ICONS: Record<string, Icon> = {
  sun,
  // The moon icons show the phase they're drawn at (see getIcon); this is how they're laid out.
  moon: crescent,
  cloud,
  "cloud-sun": layer(17, 12, [[sun, 0, 0], [cloud, 3, 5]]),
  "cloud-moon": layer(17, 12, [[crescent, 0, 0], [cloud, 3, 5]]),
  overcast: layer(16, 10, [[greyCloud, 2, 0], [cloud, 0, 3]]),
  rain: layer(14, 11, [[greyCloud, 0, 0], [rainDrops, 0, 7]]),
  drizzle: layer(14, 10, [[cloud, 0, 0], [drizzleDrops, 0, 7]]),
  snow: layer(14, 10, [[cloud, 0, 0], [snowFlakes, 0, 7]]),
  thunder: layer(14, 12, [[greyCloud, 0, 0], [bolt, 3, 6]]),
  fog,
  wind,
  heart: grid([".RR.RR.", "RRRRRRR", "RRRRRRR", ".RRRRR.", "..RRR..", "...R..."]),
  crescent,
  star: grid(["....Y....", "....Y....", "...YYY...", "YYYYYYYYY", ".YYYYYYY.", "..YYYYY..", "..YY.YY..", ".YY...YY.", ".Y.....Y."]),
  bell: grid(["....Y....", "...YYY...", "..YYYYY..", "..YYYYY..", "..YYYYY..", ".YYYYYYY.", "YYYYYYYYY", ".........", "....Y...."]),
  check: grid([".......N", "......NN", "N....NN.", "NN..NN..", ".NNNN...", "..NN...."]),
  cross: grid(["R.....R", ".R...R.", "..R.R..", "...R...", "..R.R..", ".R...R.", "R.....R"]),
  "arrow-up": arrowUp,
  "arrow-right": rot90(arrowUp),
  "arrow-down": rot90(rot90(arrowUp)),
  "arrow-left": rot90(rot90(rot90(arrowUp))),
  "trend-up": grid(["..N..", ".NNN.", "NNNNN"]),
  "trend-down": grid(["RRRRR", ".RRR.", "..R.."]),
  droplet: grid(["..B..", "..B..", ".BBB.", ".BBB.", "BBBBB", "BBBBB", ".BBB."]),
  thermometer: grid([".WWW.", ".W.W.", ".W.W.", ".WRW.", ".WRW.", ".WRW.", "WRRRW", "WRRRW", "WRRRW", ".WWW."]),
  music: grid(["..WWWWW", "..W...W", "..W...W", "..W...W", ".WW..WW", "WWW.WWW", ".W...W."]),
  mail: grid(["WWWWWWWWW", "WW.....WW", "W.W...W.W", "W..W.W..W", "W...W...W", "W.......W", "WWWWWWWWW"]),
  home: grid(["....R....", "...RRR...", "..RRRRR..", ".RRRRRRR.", "RRRRRRRRR", ".WWWWWWW.", ".WWW.WWW.", ".WWW.WWW."]),
  calendar: grid([".W.....W.", "RRRRRRRRR", "RRRRRRRRR", "WWWWWWWWW", "W.W.W.W.W", "WWWWWWWWW", "W.W.W.W.W", "WWWWWWWWW"]),
  clock: grid(["..WWWWW..", ".W..W..W.", "W...W...W", "W...W...W", "W...WWW.W", "W.......W", "W.......W", ".W.....W.", "..WWWWW.."]),
  news: grid(["WWWWWWWWW.", "W.......WW", "W.GGGG..WW", "W.......WW", "W.GGGGG.WW", "W.GGGGG.WW", "W.......WW", "WWWWWWWWWW"]),
  ghost: grid(["..PPPP..", ".PPPPPP.", "PWWPWWPP", "PWBPWBPP", "PPPPPPPP", "PPPPPPPP", "PPPPPPPP", "P.PP.PP."]),
  invader: grid(["..V.....V..", "...V...V...", "..VVVVVVV..", ".VV.VVV.VV.", "VVVVVVVVVVV", "V.VVVVVVV.V", "V.V.....V.V", "...VV.VV..."]),
};

export const WEATHER_ICON_NAMES = ["sun", "moon", "cloud", "cloud-sun", "cloud-moon", "overcast", "rain", "drizzle", "snow", "thunder", "fog", "wind"];

/** The dark side's colour: tinted, it's drawn faintly rather than in the full tint. */
export const MOON_SHADOW = PALETTE.S;

/** Icons that show the moon's phase, built from the moon at that phase. */
export const PHASED: Record<string, (moon: Icon) => Icon> = {
  moon: (m) => m,
  "cloud-moon": (m) => layer(17, 12, [[m, 0, 0], [cloud, 3, 5]]),
};

const phased = new Map<string, Icon>();

/** An icon by name, as it looks at `at` (epoch ms): the moon icons show the moon's phase then. */
export function getIcon(name: string, at = Date.now()): Icon | null {
  const n = name.trim();
  const make = PHASED[n];
  if (!make) return ICONS[n] ?? null;
  const step = moonStep(at);
  const key = `${n}:${step}`;
  let icon = phased.get(key);
  if (!icon) phased.set(key, (icon = make(moonAt(step / MOON_STEPS))));
  return icon;
}
