// Renders reels of slides with sample data into docs/assets, for the website's
// live previews: every frame, transitions and all, exactly as the device would
// show them. "reel" is the starter deck (plus Now Playing); "reel-mac" is what
// the Mac app puts on the display.
//
//   npm run reel
//
// <name>.png holds the frames, 64×32 each, COLS to a row; <name>.json says how
// long each frame stays up and where each slide starts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { allPluginInfo } from "../src/server/plugins";
import { renderClip } from "../src/shared/clip";
import { clockValues } from "../src/shared/live";
import { settleSlide } from "../src/shared/render";
import { createSystemSlide, sampleScope } from "../src/shared/templates";
import type { Frame } from "../src/shared/render";
import type { Slide } from "../src/shared/types";

const OUT = join(import.meta.dirname, "../docs/assets");
const FPS = 20;
const COLS = 16;
// A sunny, partly cloudy afternoon.
const NOW = Date.UTC(2026, 9, 8, 14, 5);

const sample = (id: string) => allPluginInfo().find((p) => p.id === id)?.sample as Record<string, unknown>;
const data = {
  weather: { ...sample("weather"), condition: "Partly cloudy", effect: "clouds" },
  stocks: sample("stocks"),
  gnews: sample("googlenews"),
  calendar: sample("mac-calendar"),
};
const scopeAt = (t: number) => ({ clock: clockValues("UTC", false, NOW + t, { lat: 51.5, lon: 0 }), ...data, $now: NOW + t });

const starter: Slide[] = JSON.parse(readFileSync(join(import.meta.dirname, "../src/shared/starter.json"), "utf8"));
const named = (name: string) => starter.find((s) => s.name === name)!;
const system = (kind: "nowplaying" | "notification" | "message") => ({ ...createSystemSlide(kind), scope: sampleScope(kind) });

await buildReel("reel", [named("Clock"), named("Weather"), named("Stocks"), system("nowplaying"), named("News"), named("Calendar")]);
await buildReel("reel-mac", [system("nowplaying"), system("notification"), system("message")]);

async function buildReel(name: string, deck: Slide[]) {
  const frames: Frame[] = [];
  const delays: number[] = [];
  const slides: { name: string; start: number; transition: string }[] = [];
  let prev: Frame | null = null;
  let at = 0;
  // Twice round, keeping the second, so the first slide's transition plays from the last one.
  for (const round of [0, 1])
    for (const played of deck) {
      const slide = settleSlide(played, { ...scopeAt(0), ...played.scope });
      const clip = renderClip(slide, { fps: FPS, prev, scopeAt: (t) => ({ ...scopeAt(t), ...slide.scope }) });
      prev = clip.frames[clip.frames.length - 1];
      if (!round) continue;
      slides.push({ name: played.name, start: at, transition: slide.transition.type === "cut" ? "" : slide.transition.type });
      frames.push(...clip.frames);
      delays.push(...clip.delays);
      at += clip.durationMs;
    }

  const rows = Math.ceil(frames.length / COLS);
  const sheet = Buffer.alloc(COLS * 64 * rows * 32 * 3);
  frames.forEach((f, n) => {
    const ox = (n % COLS) * 64;
    const oy = Math.floor(n / COLS) * 32;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        const o = ((oy + y) * COLS * 64 + ox + x) * 3;
        sheet[o] = f[i];
        sheet[o + 1] = f[i + 1];
        sheet[o + 2] = f[i + 2];
      }
  });
  mkdirSync(OUT, { recursive: true });
  await sharp(sheet, { raw: { width: COLS * 64, height: rows * 32, channels: 3 } }).png({ compressionLevel: 9 }).toFile(join(OUT, `${name}.png`));
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ cols: COLS, durationMs: at, delays, slides }) + "\n");
  console.log(`${name}: ${frames.length} frames, ${(at / 1000).toFixed(1)}s, ${slides.map((s) => s.name).join(" · ")}`);
}
