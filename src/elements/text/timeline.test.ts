import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createSlide } from "../../shared/defaults";
import { renderSlide } from "../../shared/render";
import { minDurationMs } from "../index";
import { layoutText, onceEndMs, onceSpeed, scrollExtent, type TextElement } from "./element";
import { textTracks } from "./timeline";

const once = (extra: Partial<TextElement> = {}) =>
  createElement("text", {
    text: "A long headline that does not fit",
    overflow: "marquee",
    marqueeMode: "once",
    marqueeSpeed: 20,
    state: { x: 0, y: 0, w: 30, h: 8, color: "#ffffff", opacity: 1 },
    ...extra,
  });

const overflow = (el: TextElement) => layoutText(el, {}).lines[0].width - el.state.w;

test("filling the time: a scroll-once finishes its rest before the end, whatever its speed would have been", () => {
  const el = once({ marqueeFill: true, marqueeMaxSpeed: 200, marqueeRestMs: 1000 });
  const clock = { end: 4000, outroMs: 0 };
  assert.equal(onceSpeed(el, overflow(el) + 30, 30, clock), overflow(el) / 2); // 1s start, 2s to scroll, 1s rest
  assert.equal(onceEndMs(el, overflow(el) + 30, 30, clock), 3000);
  // Before the outro line, if there is one.
  assert.equal(onceEndMs(el, overflow(el) + 30, 30, { end: 4000, outroMs: 1000 }), 2000);
  // Rendered: it has stopped by then, and holds.
  const s = createSlide();
  s.durationSec = 4;
  s.elements = [el];
  assert.deepEqual(renderSlide(s, 3000, {}), renderSlide(s, 3900, {}));
  assert.notDeepEqual(renderSlide(s, 2000, {}), renderSlide(s, 3000, {}));
  // In a Hold the time follows the text, so there's nothing to fill: it goes at its speed.
  assert.equal(onceSpeed(el, overflow(el) + 30, 30, { end: 4000, outroMs: 0, hold: [0, 4000] }), 20);
  assert.equal(onceSpeed(el, overflow(el) + 30, 30), 20);
});

test("the speed cap keeps long text readable, finishing late instead", () => {
  const el = once({ marqueeFill: true, marqueeMaxSpeed: 10, marqueeRestMs: 0 });
  const clock = { end: 2000, outroMs: 0 };
  assert.equal(onceSpeed(el, overflow(el) + 30, 30, clock), 10);
  assert.ok(onceEndMs(el, overflow(el) + 30, 30, clock) > 2000);
  const [track] = textTracks(el, {}, clock);
  assert.equal(track.spans.length, 2); // the planned span, then a faded overrun
  assert.ok(track.spans[1].faded);
});

test("timeline markers: start sets the delay; the end sets the speed, or filling the time, the rest", () => {
  const el = once();
  const [track] = textTracks(el, {}, { end: 10_000, outroMs: 0 });
  const done = onceEndMs(el, overflow(el) + 30, 30);
  assert.deepEqual(
    track.markers.map((m) => [m.id, m.t]),
    [
      ["start", 1000],
      ["end", done],
    ],
  );
  // Then it rests (1.5s unless set), shown faded.
  assert.deepEqual([track.spans[1].start, track.spans[1].end, track.spans[1].faded], [done, done + 1500, true]);
  const [start, end] = track.markers;
  start.move(el, 1500);
  assert.equal(el.marqueeDelayMs, 1500);
  end.move(el, 4000);
  assert.equal(el.marqueeSpeed, Math.round(overflow(el) / 2.5)); // over the 2.5s from the (new) start to here
  // Filling the time, the end is the rest before the end of the timeline.
  const fill = once({ marqueeFill: true });
  const [ft] = textTracks(fill, {}, { end: 10_000, outroMs: 0 });
  assert.equal(ft.markers[1].t, 8500);
  ft.markers[1].move(fill, 7000);
  assert.equal(fill.marqueeRestMs, 3000);
  // Ping-pong and loop have no end marker.
  assert.equal(textTracks(once({ marqueeMode: "pingpong" }), {}, { end: 10_000, outroMs: 0 })[0].markers.length, 1);
});

test("“Rest after” is how long a timeline waits after the scroll", () => {
  const el = once();
  const done = onceEndMs(el, overflow(el) + 30, 30);
  assert.equal(minDurationMs([el], {}), done + 1500);
  assert.equal(minDurationMs([once({ marqueeRestMs: 0 })], {}), done);
});

/* ---------------- rolling up, credits style ---------------- */

const story = "Russia attacks Ukrainian energy grid as winter looms, forcing power cuts across the country";
const roll = (extra: Partial<TextElement> = {}) =>
  createElement("text", { text: story, overflow: "marquee", marqueeDirection: "up", marqueeMode: "once", marqueeSpeed: 10, state: { x: 0, y: 0, w: 64, h: 16, color: "#ffffff", opacity: 1 }, ...extra }) as TextElement;
const frame = (el: TextElement, t: number) => {
  const s = createSlide();
  s.durationSec = 60;
  s.elements = [el];
  return renderSlide(s, t, {});
};

test("rolling up wraps the text to the box's width and moves it up, once ending on the last lines", () => {
  const el = roll();
  const { content, box } = scrollExtent(el, {});
  assert.equal(box, 16);
  assert.ok(content > 30, `wrapped to ${content}px tall`);
  // Still for "Start after", then moving, then holding once the last line is at the bottom.
  assert.deepEqual(frame(el, 0), frame(el, 900));
  assert.notDeepEqual(frame(el, 900), frame(el, 2500));
  const end = onceEndMs(el, content, box);
  assert.deepEqual(frame(el, end + 100), frame(el, end + 3000));
  // A slide (or rotator item) waits for it, plus a moment to read.
  assert.equal(minDurationMs([el], {}), end + 1500);
  // The timeline's row measures it the same way.
  const [track] = textTracks(el, {}, { end: 60_000, outroMs: 0 });
  assert.equal(track.markers.find((m) => m.id === "end")!.t, end);
});

test("text that fits the box's height doesn't roll; looping goes round again", () => {
  const short = roll({ text: "Short" });
  assert.equal(minDurationMs([short], {}), 0);
  assert.deepEqual(frame(short, 0), frame(short, 5000));
  // Breaking anywhere fills each line to the edge, so it's never taller than breaking between words.
  assert.ok(scrollExtent(roll({ wrapMode: "char" }), {}).content <= scrollExtent(roll(), {}).content);
  const loop = roll({ marqueeMode: "loop" });
  assert.notDeepEqual(frame(loop, 3000), frame(loop, 6000));
});
