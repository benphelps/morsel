import assert from "node:assert/strict";
import { test } from "node:test";
import { holdTracks } from "../elements/text/timeline";
import { createElement } from "../shared/defaults";
import { HOLD_VIEW_MS, timeView } from "./timeview";

// A rotator item with a 0.7s In and a 0.7s Out, as two stories with different
// data would have it: one holds 8.2s, the other 11.2s. Text in it starts
// scrolling 1s into the Hold.
const story = (hold: number) => ({ end: 700 + hold + 700, outroMs: 700, hold: [700, 700 + hold] as [number, number], holdMin: 3500 });

test("the timeline is drawn from settings: the Hold is one block, however long each item's data makes it", () => {
  const [a, b] = [timeView(story(8200), 1000), timeView(story(11_200), 1000)];
  assert.equal(a.total, b.total);
  assert.equal(a.total, 700 + 1000 + HOLD_VIEW_MS + 700); // "Hold at least" takes no room: it's only a floor
  // The In, and the Hold up to the latest "Start after", at the same places, at real scale.
  for (const t of [0, 350, 700, 1200, 1700]) {
    assert.equal(a.toView(t), t);
    assert.equal(b.toView(t), t);
  }
  assert.equal(a.toView(8200 + 700 + 200), b.toView(11_200 + 700 + 200)); // 0.2s into each Out
  // The rest of each Hold is squashed into the block, which ends where the Out starts.
  assert.equal(a.toView(700 + 8200), a.outStart);
  assert.ok(b.toView(6000) > 1700 && b.toView(6000) < b.outStart!);
  for (const v of [100, 1500, 2500, 3500, 4000]) assert.ok(Math.abs(b.toView(b.fromView(v)) - v) < 1e-6);
  // With nothing to wait for, all of it is squashed; a Hold shorter than the wait spreads over the block.
  assert.equal(timeView(story(8200)).total, 700 + HOLD_VIEW_MS + 700);
  const tiny = timeView(story(500), 1000);
  assert.equal(tiny.toView(700 + 500), tiny.outStart);
});

test("scroll rows in a Hold come from the text's settings, not its text", () => {
  const mk = (text: string) => createElement("text", { text, overflow: "marquee", marqueeMode: "pingpong", marqueeDelayMs: 1000 });
  // Everything but the drag handlers (functions, so never equal).
  const shape = (text: string) => holdTracks(mk(text), [700, 8900]).map((t) => ({ ...t, markers: t.markers.map(({ move: _, ...m }) => m) }));
  assert.deepEqual(shape("AP"), shape("The New York Times"));
  const short = holdTracks(mk("AP"), [700, 8900]);
  assert.equal(short[0].markers[0].t, 1700);
  assert.deepEqual([short[0].spans[0].start, short[0].spans[0].end], [1700, 8900]);
});
