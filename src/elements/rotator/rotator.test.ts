import assert from "node:assert/strict";
import { test } from "node:test";
import { stateAt } from "../../shared/animate";
import { renderClip } from "../../shared/clip";
import { createElement, createSlide } from "../../shared/defaults";
import { renderSlide, settleSlide } from "../../shared/render";
import type { AnimState, Keyframe } from "../../shared/types";
import { addKeyframe, editState, fitToContent, fixLength } from "../../web/model";
import { phaseMinimumsOf, setPhaseOn } from "../phases";
import { holdNeedMs, minDurationMs, type SlideElement } from "../index";
import { itemClock, itemLength, playOrder, rotatorItems, rotatorSchedule, rotatorTurns, turnAt, type RotatorElement } from "./element";
import { rotatorTracks } from "./timeline";

const scope = { news: { items: [{ title: "One" }, { title: "Two" }, { title: "Three" }] } };
const box = (x: number, y: number, w: number, h: number, opacity = 1): AnimState => ({ x, y, w, h, color: "#ffffff", opacity });
const key = (id: string, t: number, state: AnimState, fromEnd?: boolean): Keyframe => ({ id, t, easing: "linear", state, ...(fromEnd && { fromEnd }) });
const measure = { holdNeedMs };

const rotator = (extra: Partial<RotatorElement> = {}, children?: SlideElement[]) =>
  createElement("rotator", {
    list: "{{news.items}}",
    holdMs: 1000,
    transitionMs: 200,
    children: children ?? [createElement("text", { text: "{{item.title}}", overflow: "clip", state: box(0, 0, 64, 9) })],
    ...extra,
  }) as RotatorElement;

const render = (el: SlideElement, t: number, sc: Record<string, unknown> = scope, durationSec = 8) => {
  const s = createSlide();
  s.durationSec = durationSec;
  s.elements = [el];
  return renderSlide(s, t, sc);
};
const px = (f: Uint8ClampedArray, x: number, y: number) => [...f.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];
const red = { srcW: 1, srcH: 1, data: Buffer.from([255, 0, 0, 255]).toString("base64") };

test("a new rotator picks up the first list in the data, its titles and a small image per item", () => {
  const el = createElement("rotator", {}, { g: { items: [{ title: "x", favicon8: red }] } });
  assert.equal(el.list, "{{g.items}}");
  assert.deepEqual(
    el.children.map((c) => [c.type, c.type === "text" ? c.text : c.type === "image" ? c.src : ""]),
    [
      ["image", "{{item.favicon8}}"],
      ["text", "{{item.title}}"],
    ],
  );
});

test("each item is its In, its Hold and its Out; items take turns, looping", () => {
  const el = rotator({ inMs: 300, outMs: 200 });
  const d = rotatorSchedule(el, scope, measure);
  assert.deepEqual(d, [1500, 1500, 1500]);
  const turns = rotatorTurns(el, d, 6000);
  assert.deepEqual(
    turns.map((t) => [t.i, t.start, t.end]),
    [
      [0, 0, 1500],
      [1, 1500, 3000],
      [2, 3000, 4500],
      [0, 4500, 6000],
    ],
  );
  assert.deepEqual(itemClock(el, turns[1]), { end: 1500, outroMs: 200, hold: [300, 1300], holdMin: 1000 });
  assert.equal(turnAt(turns, 3100), 2);
  assert.notDeepEqual(render(el, 500), render(el, 2000));
  assert.deepEqual(render(el, 500), render(el, 5000));
  assert.equal(rotatorItems(rotator({ maxItems: 2 }), scope).length, 2);
});

test("an item that couldn't finish doesn't start: the one before holds on, so every Out plays in full", () => {
  const turns = rotatorTurns({ loop: true }, [1000, 1000, 1000], 2600);
  assert.deepEqual(
    turns.map((t) => [t.i, t.start, t.end]),
    [
      [0, 0, 1000],
      [1, 1000, 2600],
    ],
  );
  // Without looping, the last item holds on to the end.
  assert.deepEqual(rotatorTurns({ loop: false }, [1000, 1000], 5000).at(-1), { i: 1, start: 1000, end: 5000 });
});

test("the change-over moves the whole item layout, then settles", () => {
  const el = rotator({ transition: "push-up" });
  const mid = render(el, 1100); // 100ms into the 200ms push
  assert.notDeepEqual(mid, render(el, 1500));
  assert.notDeepEqual(mid, render(el, 500));
  assert.deepEqual(render(el, 1300), render(el, 1500));
  assert.deepEqual(render(el, 50), render(el, 500)); // the first item just appears
});

test("children are laid out in the rotator's box, see the item, and animate on item time", () => {
  const sc = { news: { items: [{ icon: red }, { icon: red }] } };
  const img = createElement("image", { src: "{{item.icon}}", state: box(2, 1, 4, 4) });
  img.keyframes = [key("a", 0, box(2, 1, 4, 4, 0)), key("b", 400, box(2, 1, 4, 4))]; // fades in over the In
  const el = rotator({ transition: "cut", inMs: 400, holdMs: 600, state: box(10, 20, 20, 8) }, [img]);
  assert.deepEqual(px(render(el, 900, sc), 13, 22), [255, 0, 0]); // at (10+2, 20+1) and in
  assert.deepEqual(px(render(el, 1000, sc), 13, 22), [0, 0, 0]); // the next item starts invisible
  assert.deepEqual(px(render(el, 1900, sc), 13, 22), [255, 0, 0]);
});

/** A headline that scrolls once, and a dot that slides in over the In and out over the Out. */
const news = () => {
  const dot = createElement("rect", {
    state: box(0, 0, 2, 2),
    keyframes: [key("i0", 0, box(-2, 0, 2, 2)), key("i1", 500, box(0, 0, 2, 2)), key("o0", 400, box(0, 0, 2, 2), true), key("o1", 0, box(64, 0, 2, 2), true)],
  });
  const title = createElement("text", { text: "{{item.title}}", overflow: "marquee", marqueeMode: "once", marqueeSpeed: 20, state: box(4, 10, 40, 8) });
  return rotator({ inMs: 500, outMs: 400, holdMs: 1000, fit: true, transition: "cut", loop: false, state: box(0, 0, 64, 32) }, [dot, title]);
};
const stories = { news: { items: [{ title: "A long headline that has to scroll for quite a while" }, { title: "Hi" }] } };

test("only the Hold changes with the content: the In and Out play the same for every item", () => {
  const el = news();
  const [long, short] = rotatorSchedule(el, stories, measure);
  assert.ok(long > 5000, `the long headline holds on (${long}ms)`);
  assert.equal(short, 500 + 1000 + 400);
  // The dot, at the same moment of each item's Out.
  const dot = el.children[0];
  const dotAt = (t: number, end: number) => stateAt(dot, t, end).x;
  for (const before of [400, 250, 100, 0]) assert.equal(dotAt(long - before, long), dotAt(short - before, short));
  assert.equal(dotAt(250, long), dotAt(250, short)); // and the In
});

test("text scrolls from the start of the Hold, not the item", () => {
  const el = news();
  const title = el.children[1];
  const sc = { news: { items: [stories.news.items[0]] } };
  const at = (t: number) => render({ ...el, children: [title] }, t, sc, 30);
  // It waits its "Start after" (1s) from the start of the Hold (0.5s in).
  assert.deepEqual(at(0), at(1450));
  assert.notDeepEqual(at(0), at(2000));
  assert.equal(holdNeedMs([title], { item: sc.news.items[0] }, 500), minDurationMs([{ ...title, keyframes: [] }], { item: sc.news.items[0] }));
});

test("without looping, the last item holds on to the end of the slide and plays its Out there", () => {
  const el = news();
  const [long] = rotatorSchedule(el, stories, measure);
  const dotPx = (t: number) => px(render(el, t, stories, 20), 1, 1);
  assert.deepEqual(dotPx(long + 1000), [255, 255, 255]); // item 2, in
  assert.deepEqual(dotPx(long + 5000), [255, 255, 255]); // still up: it runs to the slide's end
  assert.deepEqual(dotPx(19_999), [0, 0, 0]); // and leaves then
});

test("a slide fitted to its content plays one pass through the items, in whole seconds", () => {
  const el = news();
  const pass = rotatorSchedule(el, stories, measure).reduce((a, b) => a + b, 0);
  assert.equal(minDurationMs([el], stories), pass);
  const s = createSlide();
  s.durationSec = 36;
  s.elements = [el];
  assert.equal(settleSlide(s, stories), s); // not fitted: as set
  s.fit = true;
  assert.equal(settleSlide(s, stories).durationSec, Math.ceil(pass / 1000));
  assert.equal(renderClip(s, { fps: 20, scopeAt: () => stories }).durationMs, Math.ceil(pass / 1000) * 1000);
  // More stories, a longer slide.
  const more = { news: { items: [...stories.news.items, { title: "And another headline that is long enough to scroll" }] } };
  assert.ok(settleSlide(s, more).durationSec > settleSlide(s, stories).durationSec);
});

test("In and Out never shrink past their keys; edits in the Hold change the resting pose", () => {
  const el = news();
  assert.deepEqual(phaseMinimumsOf(el.children), { inMs: 500, outMs: 400 });
  setPhaseOn(el, el.children, "in", 100);
  setPhaseOn(el, el.children, "out", 900);
  assert.deepEqual([el.inMs, el.outMs], [500, 900]);
  const dot = el.children[0];
  const clock = { end: 3000, outroMs: 900, hold: [500, 2100] as [number, number] };
  // Moving it mid-Hold moves where it rests: the In's last key and the Out's first.
  editState(dot, { y: 5 }, 1200, 20, clock);
  assert.deepEqual(
    dot.keyframes.map((k) => [k.id, k.state.y]),
    [
      ["i0", 0],
      ["i1", 5],
      ["o0", 5],
      ["o1", 0],
    ],
  );
  // Keying in the Hold keys the nearer edge of it instead.
  const plain = createElement("rect", { state: box(0, 0, 2, 2) });
  addKeyframe(plain, 700, 20, clock);
  assert.deepEqual([plain.keyframes[0].t, plain.keyframes[0].fromEnd], [500, undefined]);
  addKeyframe(plain, 2000, 20, clock);
  assert.deepEqual([plain.keyframes[1].t, plain.keyframes[1].fromEnd], [900, true]);
});

test("the timeline row marks each turn, and dragging a change-over sets the shortest Hold", () => {
  const el = rotator({ inMs: 200, outMs: 300 });
  const [track] = rotatorTracks(el, scope, { end: 8000, outroMs: 0 });
  assert.deepEqual(
    track.markers.slice(0, 3).map((m) => m.t),
    [1500, 3000, 4500],
  );
  assert.equal(track.spans[1].title, "2. Two");
  track.markers[1].move(el, 4000); // the 2nd change-over at 4s: 2s an item
  assert.equal(el.holdMs, 1500);
});

test("an empty list shows the empty text", () => {
  const blank = render(rotator(), 0, { news: { items: [] } });
  const withText = render(rotator({ emptyText: "No news" }), 0, { news: { items: [] } });
  assert.notDeepEqual(blank, withText);
});

test("showing the next few items each time: each showing carries on from the last, round to the first", () => {
  const el = rotator({ perPlay: 1, transition: "cut" });
  assert.deepEqual(playOrder(el, 3, 0), [0]);
  assert.deepEqual(playOrder(el, 3, 1), [1]);
  assert.deepEqual(playOrder(el, 3, 3), [0]);
  assert.deepEqual(playOrder({ perPlay: 2 }, 5, 2), [4, 0]);
  assert.deepEqual(playOrder({ perPlay: 9 }, 3, 4), [0, 1, 2]); // more than there are: all of them
  // One item a showing holds on for the whole slide, whatever's left of it.
  const d = rotatorSchedule(el, scope, measure);
  assert.deepEqual(rotatorTurns(el, d, 5000, 1), [{ i: 1, start: 0, end: 5000 }]);
  // The second showing draws the second item, from the start; a fitted slide is as long as that one item.
  assert.deepEqual(render(el, 500, { ...scope, $play: 1 }), render(rotator({ transition: "cut" }), 1500));
  assert.equal(minDurationMs([el], { ...scope, $play: 1 }), d[1]);
});

/** A dot keyed across a fixed-length item: in at the start, across the middle, out at the end (counting from it). */
const fixedDot = () =>
  createElement("rect", {
    state: box(0, 0, 2, 2),
    keyframes: [key("a", 0, box(0, 0, 2, 2)), key("b", 600, box(30, 0, 2, 2)), key("c", 300, box(30, 0, 2, 2), true), key("d", 0, box(60, 0, 2, 2), true)],
  });

test("fixed-length items: every item is as long as set, keyed anywhere like a slide, with an outro line", () => {
  const el = rotator({ fit: undefined, lengthMs: 2000, outroMs: 300, transition: "cut", state: box(0, 0, 64, 32) }, [fixedDot()]);
  assert.deepEqual(rotatorSchedule(el, stories, measure), [2000, 2000]); // whatever the text
  assert.deepEqual(itemClock(el, { start: 2000, end: 4000 }), { end: 2000, outroMs: 300 }); // no Hold
  // A key mid-item stays mid-item.
  const plain = createElement("rect", { state: box(0, 0, 2, 2) });
  addKeyframe(plain, 1200, 20, itemClock(el, { start: 0, end: 2000 }));
  assert.deepEqual([plain.keyframes[0].t, plain.keyframes[0].fromEnd], [1200, undefined]);
  // The dot is mid-way at 1s into each item.
  const dotX = (t: number) => px(render(el, t, scope, 6), 30, 1);
  assert.deepEqual(dotX(1000), [255, 255, 255]);
  assert.deepEqual(dotX(3000), [255, 255, 255]);
  assert.equal(itemLength({ lengthMs: 10 }), 200); // never too short to move along
});

test("switching items between fixed and fit looks the same either way", () => {
  const fixed = rotator({ fit: undefined, lengthMs: 2000, outroMs: 300, transition: "cut", state: box(0, 0, 64, 32) }, [fixedDot()]);
  const fitted = structuredClone(fixed);
  fitToContent(fitted, fitted.children, itemLength(fitted));
  // The longest stretch without keys (0.6s to 1.7s) becomes the Hold.
  assert.deepEqual([fitted.fit, fitted.inMs, fitted.holdMs, fitted.outMs], [true, 600, 1100, 300]);
  assert.deepEqual(rotatorSchedule(fitted, scope, measure), [2000, 2000, 2000]);
  for (const t of [0, 500, 1000, 1500, 1800, 2500, 3900]) assert.deepEqual(render(fitted, t), render(fixed, t), `at ${t}ms`);
  // And back.
  const again = structuredClone(fitted);
  again.lengthMs = 2000;
  fixLength(again);
  assert.deepEqual([again.fit, again.outroMs, again.inMs], [undefined, 300, undefined]);
  for (const t of [0, 500, 1000, 1800, 3900]) assert.deepEqual(render(again, t), render(fixed, t), `back, at ${t}ms`);
});

test("dragging a change-over of fixed-length items sets their length", () => {
  const el = rotator({ fit: undefined, lengthMs: 1500 });
  const [track] = rotatorTracks(el, scope, { end: 8000, outroMs: 0 });
  assert.deepEqual(
    track.markers.slice(0, 2).map((m) => m.t),
    [1500, 3000],
  );
  track.markers[1].move(el, 5000); // the 2nd change-over at 5s
  assert.equal(el.lengthMs, 2500);
});
