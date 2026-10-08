import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createSlide } from "../../shared/defaults";
import { renderSlide } from "../../shared/render";
import type { EffectElement } from "./element";

const render = (el: EffectElement, t: number, scope: Record<string, unknown> = {}) => {
  const s = createSlide();
  s.elements = [el];
  return renderSlide(s, t, scope);
};
const lit = (f: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 0; i < f.length; i += 4) if (f[i] + f[i + 1] + f[i + 2] > 30) n++;
  return n;
};
const fx = (extra: Partial<EffectElement>) => createElement("effect", { seed: 42, ...extra });

test("each effect draws, moves over time, and draws the same frame every time", () => {
  for (const effect of ["rain", "snow", "stars", "clouds", "overcast"]) {
    const el = fx({ effect });
    const a = render(el, 1000);
    assert.ok(lit(a) > 10, `${effect} lights pixels`);
    assert.deepEqual(render(el, 1000), a, `${effect} is repeatable`);
    assert.notDeepEqual(render(el, effect === "clouds" || effect === "overcast" ? 3000 : 1400), a, `${effect} moves`);
  }
});

test("density scales the particle count; none and zero draw nothing", () => {
  assert.ok(lit(render(fx({ effect: "rain", density: 100 }), 500)) > lit(render(fx({ effect: "rain", density: 20 }), 500)));
  assert.equal(lit(render(fx({ effect: "rain", density: 0 }), 500)), 0);
  assert.equal(lit(render(fx({ effect: "none" }), 500)), 0);
});

test("a bound effect follows the data", () => {
  const el = fx({ effect: "{{weather.effect}}" });
  assert.equal(lit(render(el, 500, { weather: { effect: "none" } })), 0);
  assert.ok(lit(render(el, 500, { weather: { effect: "snow" } })) > 10);
});

test("a stepped motion rate holds still between steps", () => {
  const el = fx({ effect: "rain", stepMs: 200 });
  assert.deepEqual(render(el, 1010), render(el, 1190));
  assert.notDeepEqual(render(el, 1190), render(el, 1210));
});

test("each showing gets its own arrangement, the same every time it's drawn", () => {
  for (const effect of ["rain", "snow", "stars", "clouds", "overcast"]) {
    const el = fx({ effect });
    const first = render(el, 1000, { $play: 0 });
    assert.deepEqual(first, render(el, 1000), `${effect}: the first showing uses the seed as is`);
    assert.notDeepEqual(render(el, 1000, { $play: 1 }), first, `${effect}: the next showing differs`);
    assert.deepEqual(render(el, 1000, { $play: 7 }), render(el, 1000, { $play: 7 }), `${effect}: a showing is repeatable`);
    assert.notDeepEqual(render(el, 1000, { $play: 1, index: 2 }), render(el, 1000, { $play: 1, index: 1 }), `${effect}: so is each rotator item`);
  }
});
