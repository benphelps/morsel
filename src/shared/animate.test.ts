import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeIsExact, mergeKeyframes, motionSpans, splitKeyframes, stateAt } from "./animate";
import type { AnimState, Channel, ElementBase, Keyframe } from "./types";

const base: AnimState = { x: 0, y: 0, w: 10, h: 10, color: "#ffffff", opacity: 1 };
const kf = (id: string, t: number, patch: Partial<AnimState>, channel?: Channel, easing: Keyframe["easing"] = "linear"): Keyframe => ({
  id,
  t,
  easing,
  channel,
  state: { ...base, ...patch },
});
const el = (keyframes: Keyframe[], keyMode?: ElementBase["keyMode"]): ElementBase => ({ id: "e", name: "e", state: { ...base, color: "#ff0000" }, keyframes, keyMode });

test("separate channels animate on their own timing; unkeyed ones keep the element's value", () => {
  const e = el(
    [
      kf("p0", 0, { x: 0 }, "position"),
      kf("p1", 1000, { x: 10 }, "position"),
      kf("o0", 500, { opacity: 0 }, "opacity"),
      kf("o1", 1500, { opacity: 1 }, "opacity"),
    ],
    "separate",
  );
  const s = stateAt(e, 750);
  assert.equal(s.x, 7.5);
  assert.equal(s.opacity, 0.25);
  assert.equal(s.color, "#ff0000"); // colour has no keys: the element's own
  assert.equal(stateAt(e, 200).opacity, 0); // before the first opacity key: held
});

test("splitting is exact, and drops channels that never change", () => {
  const e = el([kf("a", 0, { x: -20, opacity: 0 }, undefined, "linear"), kf("b", 800, { x: 5, opacity: 1 }, undefined, "easeOutBounce"), kf("c", 2000, { x: 5, opacity: 0.5 })]);
  const before = [0, 100, 400, 799, 800, 1300, 2000, 2500].map((t) => stateAt(e, t));
  splitKeyframes(e);
  assert.equal(e.keyMode, "separate");
  assert.deepEqual(new Set(e.keyframes.map((k) => k.channel)), new Set(["position", "opacity"])); // size and colour never change
  assert.equal(e.state.color, "#ffffff"); // the constant colour moved to the element
  assert.deepEqual([0, 100, 400, 799, 800, 1300, 2000, 2500].map((t) => stateAt(e, t)), before);
});

test("merging is exact when channels share key times, and says when it isn't", () => {
  const shared = el([kf("p0", 0, { x: 0 }, "position"), kf("p1", 1000, { x: 10 }, "position"), kf("o0", 0, { opacity: 0 }, "opacity"), kf("o1", 1000, { opacity: 1 }, "opacity")], "separate");
  assert.equal(mergeIsExact(shared, 10_000), true);
  const before = [0, 250, 500, 1000].map((t) => stateAt(shared, t));
  mergeKeyframes(shared, 10_000);
  assert.equal(shared.keyMode, "together");
  assert.equal(shared.keyframes.length, 2);
  assert.ok(shared.keyframes.every((k) => !k.channel));
  assert.deepEqual([0, 250, 500, 1000].map((t) => stateAt(shared, t)), before);

  const offset = el([kf("p0", 0, { x: 0 }, "position"), kf("p1", 1000, { x: 10 }, "position"), kf("o0", 500, { opacity: 0 }, "opacity"), kf("o1", 1500, { opacity: 1 }, "opacity")], "separate");
  assert.equal(mergeIsExact(offset, 10_000), false);
  mergeKeyframes(offset, 10_000);
  assert.deepEqual(
    offset.keyframes.map((k) => k.t),
    [0, 500, 1000, 1500],
  );
});

test("a lone key is a constant: it doesn't make a merge inexact or add a key", () => {
  const e = el([kf("p0", 0, { x: 0 }, "position"), kf("p1", 1000, { x: 10 }, "position", "easeOutBounce"), kf("c", 500, { color: "#00ff00" }, "color")], "separate");
  assert.equal(mergeIsExact(e, 10_000), true);
  const before = [0, 300, 500, 700, 1000].map((t) => stateAt(e, t));
  mergeKeyframes(e, 10_000);
  assert.deepEqual(
    e.keyframes.map((k) => k.t),
    [0, 1000],
  );
  assert.deepEqual([0, 300, 500, 700, 1000].map((t) => stateAt(e, t)), before);
});

test("motion spans merge overlapping channel moves", () => {
  const e = el([kf("p0", 0, { x: 0 }, "position"), kf("p1", 1000, { x: 10 }, "position"), kf("o0", 500, { opacity: 0 }, "opacity"), kf("o1", 1500, { opacity: 1 }, "opacity"), kf("c0", 3000, { color: "#000000" }, "color"), kf("c1", 4000, { color: "#ffffff" }, "color")], "separate");
  assert.deepEqual(motionSpans(e, ["position", "size", "opacity"]), [[0, 1500]]); // colour isn't motion
});
