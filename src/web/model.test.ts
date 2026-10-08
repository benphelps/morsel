import assert from "node:assert/strict";
import { test } from "node:test";
import { stateAt } from "../shared/animate";
import { createElement } from "../shared/defaults";
import { addKeyframe, alignElements, applyPreset, editState, groupElements, removeKeyframe, resizeBox } from "./model";

const box = { x: 10, y: 10, w: 20, h: 10 };

test("free resize moves only the dragged edges", () => {
  assert.deepEqual(resizeBox(box, "se", 4, 2, false, false), { x: 10, y: 10, w: 24, h: 12 });
  assert.deepEqual(resizeBox(box, "nw", 4, 2, false, false), { x: 14, y: 12, w: 16, h: 8 });
  assert.deepEqual(resizeBox(box, "e", 5, 99, false, false), { x: 10, y: 10, w: 25, h: 10 });
});

test("aspect lock keeps 2:1 from corners and edges", () => {
  assert.deepEqual(resizeBox(box, "se", 10, 0, true, false), { x: 10, y: 10, w: 30, h: 15 });
  assert.deepEqual(resizeBox(box, "se", 0, 5, true, false), { x: 10, y: 10, w: 30, h: 15 });
  // Top-left corner anchors the bottom-right.
  assert.deepEqual(resizeBox(box, "nw", -10, 0, true, false), { x: 0, y: 5, w: 30, h: 15 });
  // Edge handles grow the other axis around the middle.
  assert.deepEqual(resizeBox(box, "e", 10, 0, true, false), { x: 10, y: 8, w: 30, h: 15 });
  assert.deepEqual(resizeBox(box, "s", 0, 5, true, false), { x: 5, y: 10, w: 30, h: 15 });
});

test("resize from centre grows both sides", () => {
  assert.deepEqual(resizeBox(box, "e", 5, 0, false, true), { x: 5, y: 10, w: 30, h: 10 });
  assert.deepEqual(resizeBox(box, "se", 5, 0, true, true), { x: 5, y: 8, w: 30, h: 15 }); // top moves up 2.5px, rounded
});

test("sizes never collapse below one pixel", () => {
  assert.deepEqual(resizeBox(box, "w", 50, 0, false, false), { x: 29, y: 10, w: 1, h: 10 });
});

/* ---------------- keying channels separately ---------------- */

/** A 5s slide with no outro line. */
const CLOCK = { end: 5000, outroMs: 0 };

const separate = () => {
  const el = createElement("rect", { keyMode: "separate" });
  editState(el, { x: 0 }, 0, 20, CLOCK); // not animated yet: a plain edit
  addKeyframe(el, 0, 20, CLOCK, "position");
  return el;
};

test("keyed separately, moving keys Position only and leaves other channels alone", () => {
  const el = separate();
  assert.equal(el.keyframes.length, 1);
  const id = editState(el, { x: 20, opacity: 0.5 }, 1000, 20, CLOCK);
  // Position gets a new key; opacity has no keys, so it's a plain edit.
  assert.deepEqual(
    el.keyframes.map((k) => [k.t, k.channel]),
    [
      [0, "position"],
      [1000, "position"],
    ],
  );
  assert.equal(el.keyframes.find((k) => k.id === id)!.state.x, 20);
  assert.equal(el.state.opacity, 0.5);
  assert.equal(stateAt(el, 500).x, 10);
});

test("keyed separately, a fade preset keys Opacity only", () => {
  const el = separate();
  editState(el, { x: 30 }, 2000, 20, CLOCK);
  applyPreset(el, "fade-in", CLOCK, 0, 20);
  assert.deepEqual(new Set(el.keyframes.map((k) => k.channel)), new Set(["position", "opacity"]));
  assert.equal(el.keyframes.filter((k) => k.channel === "position").length, 2); // the move is untouched
  assert.equal(stateAt(el, 0).opacity, 0);
});

test("removing a channel's last key leaves the element where that key had it", () => {
  const el = separate();
  const kf = addKeyframe(el, 500, 20, CLOCK, "size");
  editState(el, { w: 40 }, 500, 20, CLOCK);
  removeKeyframe(el, kf);
  assert.equal(el.state.w, 40);
  assert.ok(el.keyframes.every((k) => k.channel === "position"));
});

/* ---------------- several elements ---------------- */

const at = (x: number, y: number, w = 4, h = 4) => ({ x, y, w, h, color: "#ffffff", opacity: 1 });

test("grouping several elements keeps where they appear and their order, in the topmost one's place", () => {
  const [a, b, c] = [createElement("rect", { name: "a", state: at(10, 5) }), createElement("rect", { name: "b", state: at(30, 20, 6, 6) }), createElement("rect", { name: "c", state: at(0, 0) })];
  const list = [a, b, c];
  const group = groupElements(list, [b.id, a.id], 0, 5000)!;
  assert.deepEqual(
    list.map((e) => e.name),
    ["Group", "c"],
  );
  assert.deepEqual([group.state.x, group.state.y, group.state.w, group.state.h], [10, 5, 26, 21]);
  assert.deepEqual(
    (group as { children: typeof list }).children.map((e) => [e.name, e.state.x, e.state.y]),
    [
      ["a", 0, 0],
      ["b", 20, 15],
    ],
  );
});

test("aligning lines elements up with the box around them", () => {
  const els = [createElement("rect", { state: at(10, 5, 4, 4) }), createElement("rect", { state: at(30, 20, 10, 6) })];
  alignElements(els, "left", 0, 20, CLOCK);
  assert.deepEqual(
    els.map((e) => e.state.x),
    [10, 10],
  );
  alignElements(els, "hcenter", 0, 20, CLOCK);
  assert.deepEqual(
    els.map((e) => e.state.x),
    [13, 10],
  );
  alignElements(els, "bottom", 0, 20, CLOCK);
  assert.deepEqual(
    els.map((e) => e.state.y + e.state.h),
    [26, 26],
  );
});
