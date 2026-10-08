import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, cleanTitle, feedUrl } from "./googlenews";

test("the source comes off the end of Google News titles", () => {
  assert.equal(cleanTitle("Russia attacks energy grid - Reuters", "Reuters"), "Russia attacks energy grid");
  assert.equal(cleanTitle("Talks resume – The Guardian", "The Guardian"), "Talks resume");
  assert.equal(cleanTitle("Council on Foreign Relations (CFR) report - Council on Foreign Relations (CFR)", "Council on Foreign Relations (CFR)"), "Council on Foreign Relations (CFR) report");
  assert.equal(cleanTitle("A - B headline with a dash - NPR", "NPR"), "A - B headline with a dash");
  assert.equal(cleanTitle("No source here", "Reuters"), "No source here");
});

test("published times read compactly", () => {
  const now = Date.UTC(2026, 8, 30, 12);
  assert.equal(ago(new Date(now - 45 * 60000), now), "45m ago");
  assert.equal(ago(new Date(now - 3 * 3600000), now), "3h ago");
  assert.equal(ago(new Date(now - 50 * 3600000), now), "2d ago");
});

test("the feed URL carries the query, time window and edition", () => {
  const url = new URL(feedUrl({ query: "Ukraine", when: "1d", edition: "US:en" }));
  assert.equal(url.searchParams.get("q"), "Ukraine when:1d");
  assert.deepEqual([url.searchParams.get("hl"), url.searchParams.get("gl"), url.searchParams.get("ceid")], ["en-US", "US", "US:en"]);
  const uk = new URL(feedUrl({ query: "Київ", when: "", edition: "UA:uk" }));
  assert.equal(uk.searchParams.get("q"), "Київ");
  assert.equal(uk.searchParams.get("hl"), "uk");
  const top = new URL(feedUrl({ query: " ", when: "1d", edition: "GB:en" }));
  assert.equal(top.pathname, "/rss"); // no search: the edition's top stories
  assert.deepEqual([top.searchParams.get("q"), top.searchParams.get("ceid")], [null, "GB:en"]);
});
