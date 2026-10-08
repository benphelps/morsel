import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createSlide } from "../../shared/defaults";
import { renderSlide } from "../../shared/render";
import { rewriteBindings } from "../index";
import type { GroupElement } from "./element";

const box = (x: number, y: number, w: number, h: number, opacity = 1) => ({ x, y, w, h, color: "#ff0000", opacity });
const render = (els: ReturnType<typeof createElement>[], t = 0) => {
  const s = createSlide();
  s.elements = els;
  return renderSlide(s, t, {});
};
const px = (f: Uint8ClampedArray, x: number, y: number) => [...f.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];

const groupOf = (extra: Partial<GroupElement>) => createElement("group", { children: [createElement("rect", { state: box(2, 2, 4, 4) })], ...extra });

test("children draw relative to the group, and move with its keyframes", () => {
  const g = groupOf({ state: box(20, 10, 30, 20) });
  assert.deepEqual(px(render([g]), 23, 13), [255, 0, 0]); // (20+2+1, 10+2+1)
  assert.deepEqual(px(render([g]), 3, 3), [0, 0, 0]);
  g.keyframes = [
    { id: "a", t: 0, easing: "linear", state: box(0, 0, 30, 20) },
    { id: "b", t: 1000, easing: "linear", state: box(30, 0, 30, 20) },
  ];
  assert.deepEqual(px(render([g], 1000), 33, 3), [255, 0, 0]);
});

test("the group's opacity fades its children; clipping cuts them at its box", () => {
  const faded = px(render([groupOf({ state: box(0, 0, 64, 32, 0.5) })]), 3, 3);
  assert.ok(faded[0] > 100 && faded[0] < 150, `half red, got ${faded}`);
  const clipped = groupOf({ clip: true, state: box(0, 0, 4, 4) });
  assert.deepEqual(px(render([clipped]), 3, 3), [255, 0, 0]);
  assert.deepEqual(px(render([clipped]), 5, 5), [0, 0, 0]); // past the group's box
  assert.deepEqual(px(render([{ ...clipped, clip: false }]), 5, 5), [255, 0, 0]);
});

test("hidden groups hide everything; renaming a source reaches inside", () => {
  assert.deepEqual(px(render([groupOf({ hidden: true, state: box(0, 0, 64, 32) })]), 3, 3), [0, 0, 0]);
  const g = createElement("group", { children: [createElement("text", { text: "{{old.x}}" })] });
  rewriteBindings(g, (s) => s.replace("{{old", "{{new"));
  assert.equal((g.children[0] as { text: string }).text, "{{new.x}}");
});
