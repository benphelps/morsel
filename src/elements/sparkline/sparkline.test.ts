import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "../../shared/defaults";
import { setSparklineData, type SparklineElement } from "./element";

const scope = {
  stocks: { GSPC: { series: [7700, 7690], prevClose: 7743 }, AAPL: { series: [330, 333], prevClose: 329 } },
  item: { series: [330, 333], prevClose: 329 },
};

test("inside a rotator, a new sparkline plots the item, against the item's previous close", () => {
  const el = createElement("sparkline", {}, scope) as SparklineElement;
  assert.deepEqual([el.data, el.baseline], ["{{item.series}}", "{{item.prevClose}}"]);
});

test("pointing it at other data takes that data's previous close along, but keeps a reference value you typed", () => {
  const el = createElement("sparkline", { data: "{{stocks.GSPC.series}}", baseline: "{{stocks.GSPC.prevClose}}" }) as SparklineElement;
  setSparklineData(el, "{{item.series}}", scope);
  assert.equal(el.baseline, "{{item.prevClose}}");
  el.baseline = "330";
  setSparklineData(el, "{{stocks.AAPL.series}}", scope);
  assert.equal(el.baseline, "330");
});
