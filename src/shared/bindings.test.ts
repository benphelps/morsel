import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsIn, numFilter, parseNumFilter, replaceBinding, resolveTemplate } from "./bindings";

/* ---------------- number formats ---------------- */

test("num formats numbers: decimals, separators, sign before the prefix, percent and compact", () => {
  const f = (text: string, scope: Record<string, unknown>) => resolveTemplate(text, scope);
  const sc = { p: 1234567.891, d: -4.981, up: 1.1, big: 1530000, zero: -0.001 };
  assert.equal(f("{{p|num:2:comma:pre=$}}", sc), "$1,234,567.89");
  assert.equal(f("{{d|num:2:sign:pre=$}}", sc), "-$4.98");
  assert.equal(f("{{up|num:2:sign:pct}}", sc), "+1.10%");
  assert.equal(f("{{big|num::compact}}", sc), "1.5M");
  assert.equal(f("{{big|num:2:compact:suf=_views}}", sc), "1.53M views");
  assert.equal(f("{{zero|num:2:sign}}", sc), "0.00"); // rounded to nothing: no sign
  assert.equal(f("{{p|num}}", sc), "1234567.891");
});

test("a format's settings go in and out of its filter, and bindings in text can be swapped", () => {
  const fmt = { decimals: 2, comma: true, sign: true, style: "pct" as const, prefix: "$", suffix: " USD" };
  assert.equal(numFilter(fmt), "num:2:comma:sign:pct:pre=$:suf=_USD");
  assert.deepEqual(parseNumFilter(numFilter(fmt)), fmt);
  assert.equal(parseNumFilter("round:2"), null);
  const text = "AAPL {{item.change|abs}} today";
  const [ref] = bindingsIn(text);
  assert.deepEqual([ref.path, ref.filters], ["item.change", ["abs"]]);
  assert.equal(replaceBinding(text, ref, ["abs", "num:1"]), "AAPL {{item.change|abs|num:1}} today");
});
