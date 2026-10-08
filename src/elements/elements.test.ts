import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createSlide } from "../shared/defaults";
import { renderSlide } from "../shared/render";
import { ELEMENT_TYPES, elementDef, minDurationMs, rewriteBindings } from "./index";

test("every element type has a definition that creates and draws", () => {
  assert.equal(new Set(ELEMENT_TYPES).size, ELEMENT_TYPES.length);
  for (const type of ELEMENT_TYPES) {
    const def = elementDef(type);
    assert.equal(def.type, type);
    assert.ok(def.label && def.icon, `${type} needs a label and icon`);
    const el = createElement(type);
    assert.equal(el.type, type);
    assert.equal(el.name, def.label);
    assert.ok(el.state.w > 0 && el.state.h > 0, `${type} starts with a visible box`);
    for (const key of def.bindable ?? []) {
      const v = (el as unknown as Record<string, unknown>)[key];
      assert.ok(v === undefined || typeof v === "string", `${type}.${key} is bindable, so must be a string`);
    }
    const slide = createSlide();
    slide.elements = [el];
    renderSlide(slide, 0, {}); // must not throw
  }
});

test("unknown element types are skipped, not fatal", () => {
  const slide = createSlide();
  slide.elements = [{ ...createElement("rect"), type: "hologram" } as any];
  assert.doesNotThrow(() => renderSlide(slide, 0, {}));
});

test("rewriteBindings covers each type's bindable fields and showIf", () => {
  const rename = (s: string) => s.replace(/\{\{\s*old(?=[.|\s}])/g, "{{new");
  const spark = createElement("sparkline", { data: "{{old.a.series}}", baseline: "{{old.a.prevClose}}", showIf: "!{{old.a}}" });
  rewriteBindings(spark, rename);
  assert.deepEqual([spark.data, spark.baseline, spark.showIf], ["{{new.a.series}}", "{{new.a.prevClose}}", "!{{new.a}}"]);
  const img = createElement("image", { src: "{{old.img}}" });
  rewriteBindings(img, rename);
  assert.equal(img.src, "{{new.img}}");
  const text = createElement("text", { text: "{{older.x}} {{old.x}}" });
  rewriteBindings(text, rename);
  assert.equal(text.text, "{{older.x}} {{new.x}}");
});

test("minDurationMs asks each type, e.g. text that scrolls once", () => {
  const once = createElement("text", { text: "x".repeat(40), overflow: "marquee", marqueeMode: "once", marqueeSpeed: 20 });
  const loop = createElement("text", { text: "x".repeat(40), overflow: "marquee", marqueeMode: "loop" });
  assert.ok(minDurationMs([once, createElement("rect")], {}) > 2500);
  assert.equal(minDurationMs([loop, createElement("icon")], {}), 0);
});

test("colour from data: a number picks the colour, and anything else keeps the element's own", () => {
  const rect = (value: string) =>
    createElement("rect", { state: { x: 0, y: 0, w: 2, h: 2, color: "#0000ff", opacity: 1 }, colorFrom: { value, threshold: 0, above: "#00ff00", below: "#ff0000", equal: "#808080" } });
  const at = (el: ReturnType<typeof rect>, scope: Record<string, unknown>) => {
    const s = createSlide();
    s.elements = [el];
    const f = renderSlide(s, 0, scope);
    return [...f.slice(0, 3)];
  };
  assert.deepEqual(at(rect("{{q.change}}"), { q: { change: 1.2 } }), [0, 255, 0]);
  assert.deepEqual(at(rect("{{q.change}}"), { q: { change: -0.4 } }), [255, 0, 0]);
  assert.deepEqual(at(rect("{{q.change}}"), { q: { change: 0 } }), [128, 128, 128]);
  assert.deepEqual(at(rect("{{q.missing}}"), { q: {} }), [0, 0, 255]);
});
