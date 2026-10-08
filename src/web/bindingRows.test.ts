import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingRows, groupRows, preview } from "./bindingRows";

const favicon = { srcW: 16, srcH: 16, data: "AAAA" };
const scope = {
  $play: 2,
  stocks: { list: [{ symbol: "NET", price: 350.6 }], NET: { price: 350.6, change: 3.4, series: [1, 2, 3], name: "Cloudflare" } },
  gnews: { items: [{ title: "Hi", favicon }] },
  item: { symbol: "NET", change: 3.4, up: true },
  index: 1,
  count: 4,
};
const paths = (kind: Parameters<typeof bindingRows>[1]) => bindingRows(scope, kind).map((r) => r.path);

test("each kind of field offers only what fits there, never the renderer's own $-names", () => {
  assert.ok(paths("number").includes("item.change") && paths("number").includes("stocks.NET.price"));
  assert.ok(!paths("number").some((p) => p.startsWith("$") || p.endsWith("srcW")));
  assert.ok(!paths("number").includes("stocks.NET.name"));
  assert.deepEqual(paths("list"), ["stocks.list", "gnews.items"]);
  assert.deepEqual(paths("series"), ["stocks.NET.series"]);
  assert.deepEqual(paths("image"), ["gnews.items.0.favicon"]);
  assert.ok(paths("text").includes("stocks.NET.name") && paths("text").includes("item.up"));
  assert.ok(!paths("text").some((p) => p.endsWith(".data")));
  assert.ok(paths("any").includes("gnews.items")); // a condition can test whether a list is empty
});

test("in a rotator the item comes first, with its index and count", () => {
  const groups = groupRows(bindingRows(scope, "number"), scope);
  assert.equal(groups[0].id, "item");
  assert.deepEqual(
    groups[0].rows.map((r) => r.path),
    ["item.change", "index", "count"],
  );
  assert.deepEqual(groups.map((g) => g.id), ["item", "stocks"]);
});

test("values are shown in a few words", () => {
  assert.equal(preview(350.6), "350.6");
  assert.equal(preview([1, 2, 3]), "3 numbers");
  assert.equal(preview([{ a: 1 }]), "list of 1");
  assert.equal(preview(favicon), "16×16 image");
  assert.equal(preview(""), "empty");
});
