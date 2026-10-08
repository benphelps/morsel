import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { conditionHolds } from "../shared/bindings";
import { createProject } from "../shared/defaults";
import { renderSlide } from "../shared/render";
import { ensureSystemSlides, kindForPayload, SAMPLE_NOTIFY } from "../shared/templates";
import { buildNotificationSlide, slideFromTemplate, templateFor } from "./notify";

const project = createProject("UTC");
ensureSystemSlides(project);
const px = (f: Uint8ClampedArray, x: number, y: number) => [...f.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];

test("show-only-if conditions", () => {
  const scope = { n: { image: { data: "x" }, icon: "", zero: 0, list: [] } };
  assert.equal(conditionHolds("", scope), true);
  assert.equal(conditionHolds("{{n.image}}", scope), true);
  assert.equal(conditionHolds("!{{n.image}}", scope), false);
  assert.equal(conditionHolds("{{n.icon}}", scope), false);
  assert.equal(conditionHolds("!n.icon", scope), true);
  assert.equal(conditionHolds("{{n.zero}}", scope), false);
  assert.equal(conditionHolds("{{n.list}}", scope), false);
  assert.equal(conditionHolds("{{n.missing}}", scope), false);
});

test("payloads pick the right system slide", () => {
  assert.equal(kindForPayload({ style: "nowplaying", title: "x" }), "nowplaying");
  assert.equal(kindForPayload({ title: "Mom" }), "notification");
  assert.equal(kindForPayload({}), "message");
});

test("now playing draws the album art when there is some, the fallback icon when not", async () => {
  const red = (await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ff0000" } }).png().toBuffer()).toString("base64");
  const withArt = await buildNotificationSlide(project, { style: "nowplaying", title: "Song", subtitle: "Artist", image: red });
  assert.equal((withArt.scope as any).notify.image.srcW, 32);
  assert.deepEqual(px(renderSlide(withArt, 5000, withArt.scope!), 16, 16), [255, 0, 0]);

  const noArt = await buildNotificationSlide(project, { style: "nowplaying", title: "Song" });
  const f = renderSlide(noArt, 5000, noArt.scope!);
  let lit = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (px(f, x, y).some((c) => c > 0)) lit++;
  assert.ok(lit > 20, "music icon drawn in the art slot");
  assert.equal(noArt.id.startsWith("ntf_"), true); // a copy, never the template itself
});

test("animated artwork decodes at its keyframed size, not its unused base state", async () => {
  // Left half red, right half blue.
  const halves = Buffer.alloc(64 * 64 * 3);
  for (let i = 0; i < 64 * 64; i++) halves.set((i % 64) < 32 ? [255, 0, 0] : [0, 0, 255], i * 3);
  const cover = (await sharp(halves, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer()).toString("base64");
  const p = structuredClone(project);
  const art = templateFor(p, "nowplaying").elements.find((e) => e.name === "Artwork")!;
  const box = { ...art.state, w: 32, h: 32 };
  art.state = { ...art.state, w: 1, h: 1, opacity: 0 };
  art.keyframes = [
    { id: "k1", t: 0, easing: "linear", state: { ...box, x: -33 } },
    { id: "k2", t: 1000, easing: "linear", state: box },
  ];
  const s = await buildNotificationSlide(p, { style: "nowplaying", title: "Song", image: cover });
  assert.equal((s.scope as any).notify.image.srcW, 32);
  const f = renderSlide(s, 2000, s.scope!);
  assert.deepEqual([px(f, 4, 16), px(f, 28, 16)], [[255, 0, 0], [0, 0, 255]]);
});

test("now playing lines ping-pong by default; editing the template changes notifications", () => {
  const tpl = templateFor(project, "nowplaying");
  assert.ok(tpl.elements.filter((e) => e.type === "text").every((e: any) => e.marqueeMode === "pingpong"));
  tpl.durationSec = 15;
  assert.equal(slideFromTemplate(tpl, SAMPLE_NOTIFY.nowplaying).durationSec, 15);
});

test("scroll-once text stretches a notification so it can finish", () => {
  const long = slideFromTemplate(templateFor(project, "notification"), { ...SAMPLE_NOTIFY.notification, text: "x".repeat(120) });
  assert.ok(long.durationSec > 8);
});
