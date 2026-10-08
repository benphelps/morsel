import assert from "node:assert/strict";
import { test } from "node:test";
import { getIcon } from "./icons";
import { icon2xAt, iconForScale } from "./icons2x";
import { moonPhase } from "./moon";

// Known phases (UTC): new moon 11 Jan 2024 11:57, first quarter 18 Jan 03:52, full 25 Jan 17:54, last quarter 2 Feb 23:18.
const NEW = Date.UTC(2024, 0, 11, 11, 57);
const FIRST = Date.UTC(2024, 0, 18, 3, 52);
const FULL = Date.UTC(2024, 0, 25, 17, 54);
const LAST = Date.UTC(2024, 1, 2, 23, 18);

const near = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b)) < 0.03; // within a day

test("the moon's phase follows the date", () => {
  assert.ok(near(moonPhase(NEW), 0));
  assert.ok(near(moonPhase(FIRST), 0.25));
  assert.ok(near(moonPhase(FULL), 0.5));
  assert.ok(near(moonPhase(LAST), 0.75));
});

const MOON = "#f1e6b8";
/** Sunlit pixels in the left and right halves. */
function halves(icon: { w: number; h: number; px: (string | null)[] }) {
  let left = 0;
  let right = 0;
  icon.px.forEach((c, i) => c === MOON && ((i % icon.w) * 2 < icon.w ? left++ : right++));
  return { left, right };
}

test("the moon icons show the phase they're drawn at", () => {
  for (const icon of [getIcon("moon", NEW)!, icon2xAt("moon", NEW)!]) assert.deepEqual(halves(icon), { left: 0, right: 0 }, "a new moon is dark, its disc drawn dimly");
  assert.ok(getIcon("moon", NEW)!.px.some(Boolean));
  for (const icon of [getIcon("moon", FIRST)!, icon2xAt("moon", FIRST)!]) {
    const h = halves(icon);
    assert.ok(h.right > 0 && h.left <= h.right / 4, "first quarter: lit on the right");
  }
  for (const icon of [getIcon("moon", LAST)!, icon2xAt("moon", LAST)!]) {
    const h = halves(icon);
    assert.ok(h.left > 0 && h.right <= h.left / 4, "last quarter: lit on the left");
  }
  const full = halves(getIcon("moon", FULL)!);
  assert.ok(full.left > 20 && full.right > 20);
  // The cloud version too, and the sizes never change (the box fits every phase).
  assert.notDeepEqual(getIcon("cloud-moon", NEW)!.px, getIcon("cloud-moon", FULL)!.px);
  assert.deepEqual([iconForScale("moon", 2, false, NEW)!.icon.w, iconForScale("moon", 1, false, FULL)!.icon.w], [22, 11]);
  // The crescent stays as drawn.
  assert.deepEqual(getIcon("crescent", NEW), getIcon("crescent", FULL));
});
