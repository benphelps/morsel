import assert from "node:assert/strict";
import { test } from "node:test";
import { placeKey, resolveKeys, stateAt } from "../shared/animate";
import { createElement, createSlide } from "../shared/defaults";
import { renderSlide, settleSlide } from "../shared/render";
import type { AnimState, Keyframe } from "../shared/types";
import { addKeyframe, applyPreset, editState, fitSlideToContent, fixSlideLength, moveKey, setOutroOn } from "../web/model";
import { minDurationMs } from "./index";
import { phaseMinimumsOf, setPhaseOn } from "./phases";

// The outro line: keys after it count back from the end of their timeline
// (the slide's, or a rotator item's), so exits keep their place however long it runs.

const box = (x: number, y = 0, w = 4, h = 4, opacity = 1): AnimState => ({ x, y, w, h, color: "#ff0000", opacity });
const key = (id: string, t: number, state: AnimState, fromEnd?: boolean): Keyframe => ({ id, t, easing: "linear", state, ...(fromEnd && { fromEnd }) });
const px = (f: Uint8ClampedArray, x: number, y: number) => [...f.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];

/** A red square that slides in over the first second and out over the last one (counted from the end). */
const slider = () =>
  createElement("rect", {
    state: box(0),
    keyframes: [key("in0", 0, box(-4)), key("in1", 1000, box(0)), key("out0", 1000, box(0), true), key("out1", 0, box(64), true)],
  });

test("keys counted from the end land that far before the end of any length of timeline", () => {
  const el = slider();
  assert.deepEqual(
    resolveKeys(el, 5000).keyframes.map((k) => [k.id, k.t]),
    [
      ["in0", 0],
      ["in1", 1000],
      ["out0", 4000],
      ["out1", 5000],
    ],
  );
  assert.equal(stateAt(el, 4500, 5000).x, 32);
  assert.equal(stateAt(el, 4500, 9000).x, 0); // a longer slide: still holding
  assert.equal(stateAt(el, 8500, 9000).x, 32);
  const k = key("k", 0, box(0));
  placeKey(k, 4600, { end: 5000, outroMs: 1000 });
  assert.deepEqual([k.t, k.fromEnd], [400, true]);
  placeKey(k, 3000, { end: 5000, outroMs: 1000 });
  assert.deepEqual([k.t, k.fromEnd], [3000, undefined]);
});

test("a slide's exit follows its end when the slide gets longer", () => {
  const s = createSlide();
  s.elements = [slider()];
  s.durationSec = 5;
  assert.deepEqual(px(renderSlide(s, 3000, {}), 1, 1), [255, 0, 0]);
  assert.deepEqual(px(renderSlide(s, 4999, {}), 1, 1), [0, 0, 0]); // gone by the end
  s.durationSec = 12;
  assert.deepEqual(px(renderSlide(s, 4999, {}), 1, 1), [255, 0, 0]); // no longer leaving at 4s
  assert.deepEqual(px(renderSlide(s, 11999, {}), 1, 1), [0, 0, 0]);
});

test("a timeline needs its intros and scrolling done, then room for the longest outro", () => {
  assert.equal(minDurationMs([slider()], {}), 1000 + 1000);
  const text = createElement("text", { text: "A headline far too long to fit", overflow: "marquee", marqueeMode: "once", marqueeSpeed: 20, state: box(0, 0, 30, 8) });
  const scrollOnly = minDurationMs([text], {});
  assert.equal(minDurationMs([text, slider()], {}), scrollOnly + 1000);
  // Inside a group: same timeline, same rule.
  assert.equal(minDurationMs([text, createElement("group", { children: [slider()] })], {}), scrollOnly + 1000);
});

test("moving the outro line re-anchors keys without moving them; keys dragged past it count from the end", () => {
  const el = createElement("rect", { state: box(0), keyframes: [key("a", 0, box(0)), key("b", 3000, box(10)), key("c", 4500, box(20))] });
  const slide = createSlide();
  slide.elements = [el];
  setOutroOn(slide, slide.elements, 1000, 5000);
  assert.equal(slide.outroMs, 1000);
  assert.deepEqual(
    el.keyframes.map((k) => [k.id, k.t, !!k.fromEnd]),
    [
      ["a", 0, false],
      ["b", 3000, false],
      ["c", 500, true],
    ],
  );
  const clock = { end: 5000, outroMs: 1000 };
  moveKey(el, "b", 4200, clock, 20);
  assert.deepEqual([el.keyframes.find((k) => k.id === "b")!.t, el.keyframes.find((k) => k.id === "b")!.fromEnd], [800, true]);
  setOutroOn(slide, slide.elements, 0, 5000); // removing the line: back to plain times
  assert.equal(slide.outroMs, undefined);
  assert.deepEqual(
    el.keyframes.map((k) => [k.id, k.t, !!k.fromEnd]),
    [
      ["a", 0, false],
      ["b", 4200, false],
      ["c", 4500, false],
    ],
  );
});

test("editing at the playhead inside the outro keys from the end; exit presets do too", () => {
  const clock = { end: 5000, outroMs: 1000 };
  const el = createElement("rect", { state: box(0) });
  addKeyframe(el, 0, 20, clock);
  const id = editState(el, { x: 30 }, 4750, 20, clock);
  const k = el.keyframes.find((k) => k.id === id)!;
  assert.deepEqual([k.t, k.fromEnd, k.state.x], [250, true, 30]);
  const exit = createElement("rect", { state: box(0) });
  applyPreset(exit, "exit-right", { end: 5000, outroMs: 600 }, 0, 20);
  assert.deepEqual(
    exit.keyframes.map((k) => [k.t, !!k.fromEnd]),
    [
      [600, true],
      [0, true],
    ],
  );
  assert.equal(stateAt(exit, 8000, 8000).x, 64); // off the right edge at the end of a longer timeline
  // On an end that isn't a whole number of frames, the distance from the end still is.
  const odd = createElement("rect", { state: box(0) });
  applyPreset(odd, "fade-out", { end: 11_933, outroMs: 600 }, 0, 20);
  assert.deepEqual(
    odd.keyframes.map((k) => k.t),
    [600, 0],
  );
});

/* ---------------- slides fitted to their content ---------------- */

/** Like a calendar slide: 9s, an icon in over the first second, out over the last, and a title that scrolls once. */
const calendar = (title: string) => {
  const s = createSlide();
  s.durationSec = 9;
  const icon = createElement("rect", { state: box(0), keyframes: [key("a", 0, box(-4)), key("b", 1000, box(0)), key("c", 8000, box(0)), key("d", 9000, box(64))] });
  const text = createElement("text", { text: title, overflow: "marquee", marqueeMode: "once", marqueeSpeed: 20, state: box(0, 20, 60, 8) });
  s.elements = [icon, text];
  return s;
};

test("fitting a slide keeps how it looks now: the longest stretch without keys becomes its Hold", () => {
  const s = calendar("");
  const before = [0, 500, 3000, 8500].map((t) => renderSlide(s, t, {}));
  fitSlideToContent(s);
  assert.deepEqual([s.inMs, s.outMs, s.holdMs], [1000, 1000, 7000]);
  assert.deepEqual(
    s.elements[0].keyframes.map((k) => [k.t, !!k.fromEnd]),
    [
      [0, false],
      [1000, false],
      [1000, true],
      [0, true],
    ],
  );
  // Nothing to scroll (no events): it plays for its shortest Hold, exactly as before.
  const played = settleSlide(s, {});
  assert.equal(played.durationSec, 9);
  assert.deepEqual(
    [0, 500, 3000, 8500].map((t) => renderSlide(played, t, {})),
    before,
  );
});

test("a fitted slide grows with its content, and its Out stays at the end", () => {
  const s = calendar("A meeting with a title long enough that it has to scroll a good way");
  fitSlideToContent(s);
  const played = settleSlide(s, {});
  assert.ok(played.durationSec > 9, `plays ${played.durationSec}s`);
  const end = played.durationSec * 1000;
  assert.equal(stateAt(s.elements[0], end - 500, end).x, 32); // halfway out, half a second before the end
  assert.equal(stateAt(s.elements[0], 8500, end).x, 0); // not leaving at 8s any more
  // Back to a set length: the Out's keys stay counted from the end, as its outro.
  fixSlideLength(s, 12);
  assert.deepEqual([s.fit, s.durationSec, s.outroMs], [undefined, 12, 1000]);
  assert.equal(stateAt(s.elements[0], 11_500, 12_000).x, 32);
});

test("a fitted slide's own scrolling text starts in its Hold, as the timeline shows", () => {
  const text = createElement("text", { text: "A long headline that has to scroll for quite a while", overflow: "marquee", marqueeMode: "once", marqueeSpeed: 20, state: { ...box(0, 10, 64, 8), color: "#ffffff" } });
  const s = createSlide();
  s.elements = [text];
  s.fit = true;
  s.inMs = 1500;
  const played = settleSlide(s, {});
  const at = (t: number) => renderSlide(played, t, {});
  // It waits its "Start after" (1s) from the start of the Hold (1.5s in), not the slide.
  assert.deepEqual(at(0), at(2450));
  assert.notDeepEqual(at(0), at(3000));
});

test("keys resting on the edge of the In or Out move with it, but the start of an animation holds it", () => {
  // An icon slides in, then a key on the Out's edge (1.64s from the end) that changes nothing.
  const icon = createElement("rect", { state: box(0), keyframes: [key("a", 0, box(-4)), key("b", 1000, box(0)), key("rest", 1640, box(0), true)] });
  const s = createSlide();
  s.elements = [icon];
  s.fit = true;
  s.inMs = 1000;
  s.outMs = 1640;
  assert.deepEqual(phaseMinimumsOf(s.elements, s), { inMs: 1000, outMs: 0 }); // "b" ends the slide-in, so it holds the In
  setPhaseOn(s, s.elements, "out", 500);
  assert.equal(s.outMs, 500);
  assert.deepEqual([icon.keyframes[2].t, icon.keyframes[2].fromEnd], [500, true]); // still on the edge
  // Once it starts an exit, it holds the Out: moving it would squeeze the exit.
  icon.keyframes.push(key("gone", 0, box(70), true));
  setPhaseOn(s, s.elements, "out", 100);
  assert.equal(s.outMs, 500);
  // On the In's edge, the same: a key just like the one before it moves, and landing on it, goes.
  const text = createElement("rect", { state: box(0), keyframes: [key("a", 0, box(-4)), key("b", 600, box(0)), key("c", 1000, box(0))] });
  const t = { inMs: 1000, outMs: 0 };
  setPhaseOn(t, [text], "in", 400);
  assert.equal(t.inMs, 600); // no shorter than "b", which ends the slide-in
  assert.deepEqual(
    text.keyframes.map((k) => [k.id, k.t]),
    [
      ["a", 0],
      ["b", 600],
    ],
  );
});
