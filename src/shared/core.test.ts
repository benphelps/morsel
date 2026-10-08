import assert from "node:assert/strict";
import { test } from "node:test";
import { dwellFor } from "../server/device";
import { stateAt } from "./animate";
import { numericSeriesPaths, resolveNumber, resolveSeries, resolveTemplate } from "./bindings";
import { renderClip } from "./clip";
import { createElement, createProject, createSlide } from "./defaults";
import { clockValues } from "./live";
import { FONT_DATA } from "./fontdata";
import { getFont, listFonts } from "./fonts";
import { ICONS_2X, iconForScale } from "./icons2x";
import { layoutText, loopOffset, movingSpans, pingPongCycleMs, pingPongOffset, scrollClock, slideTimeAt, wrapLine } from "../elements/text/element";
import { renderSlide } from "./render";

test("bindings resolve paths and filters", () => {
  const scope = { w: { temp: 18.6, cond: "clear", items: [{ t: "a" }] } };
  assert.equal(resolveTemplate("{{w.temp|round}}°", scope), "19°");
  assert.equal(resolveTemplate("{{w.cond|upper}}", scope), "CLEAR");
  assert.equal(resolveTemplate("{{w.items.0.t}}/{{w.items[0].t}}", scope), "a/a");
  assert.equal(resolveTemplate("{{w.missing}}", scope), "--");
  assert.equal(resolveTemplate("{{w.missing|default:n/a}}", scope), "n/a");
});

test("keyframes interpolate the whole element state together", () => {
  const el = createElement("rect");
  el.keyframes = [
    { id: "a", t: 0, easing: "linear", state: { x: 0, y: 0, w: 10, h: 10, color: "#000000", opacity: 0 } },
    { id: "b", t: 1000, easing: "linear", state: { x: 20, y: 10, w: 10, h: 10, color: "#ffffff", opacity: 1 } },
  ];
  const mid = stateAt(el, 500);
  assert.equal(mid.x, 10);
  assert.equal(mid.y, 5);
  assert.equal(mid.opacity, 0.5);
  assert.equal(mid.color, "#808080");
  assert.equal(stateAt(el, 5000).x, 20);
});

test("static slides collapse to one frame; animated ones keep their length", () => {
  const still = createSlide();
  still.elements = [createElement("rect")];
  const a = renderClip(still, { fps: 20, scopeAt: () => ({}) });
  assert.equal(a.frames.length, 1);
  assert.equal(a.delays[0], still.durationSec * 1000);

  const moving = createSlide();
  const el = createElement("rect");
  el.keyframes = [
    { id: "a", t: 0, easing: "linear", state: { ...el.state, x: 0 } },
    { id: "b", t: 1000, easing: "linear", state: { ...el.state, x: 40 } },
  ];
  moving.elements = [el];
  const b = renderClip(moving, { fps: 20, scopeAt: () => ({}) });
  assert.ok(b.frames.length > 10);
  assert.equal(b.delays.reduce((x, y) => x + y, 0), moving.durationSec * 1000);
});

test("dwell plays an animated clip exactly once", () => {
  assert.equal(dwellFor(1, 8), 8); // stills hold for the full dwell
  assert.equal(dwellFor(40, 8), 7); // loop check after 8s > 7s → stop after one pass
  assert.equal(dwellFor(40, 1), 1);
});

test("clock values respect the time zone", () => {
  const t = Date.UTC(2026, 8, 27, 17, 5, 9);
  assert.equal(clockValues("America/Chicago", false, t).time, "12:05");
  assert.equal(clockValues("Europe/Kiev", false, t).time, "20:05");
  assert.equal(clockValues("UTC", true, t).time, "5:05");
});

test("text renders lit pixels", () => {
  const s = createSlide();
  s.elements = [createElement("text", { text: "Hi" } as any)];
  const f = renderSlide(s, 0, {});
  let lit = 0;
  for (let i = 0; i < f.length; i += 4) if (f[i] > 0) lit++;
  assert.ok(lit > 5);
});

test("a once-marquee scrolls until the text's right end meets the box edge, then holds", () => {
  const s = createSlide();
  const el = createElement("text", {
    text: "A long headline that does not fit",
    overflow: "marquee",
    marqueeMode: "once",
    marqueeSpeed: 20,
    state: { x: 0, y: 0, w: 30, h: 8, color: "#ffffff", opacity: 1 },
  } as any);
  s.elements = [el];
  const rightmostLit = (t: number) => {
    const f = renderSlide(s, t, {});
    let max = -1;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 64; x++) if (f[(y * 64 + x) * 4] > 0) max = Math.max(max, x);
    return max;
  };
  const late = renderSlide(s, 60_000, {});
  const later = renderSlide(s, 120_000, {});
  assert.deepEqual(late, later); // holds once finished
  assert.ok(rightmostLit(60_000) >= 26 && rightmostLit(60_000) <= 29); // end of text sits at the box's right edge
});

test("wrap mode breaks lines at spaces to fit the box, splitting over-long words", () => {
  const font = getFont("tom-thumb"); // 4px advance
  assert.deepEqual(wrapLine(font, "the quick brown fox", 40), ["the quick", "brown fox"]);
  assert.deepEqual(wrapLine(font, "abcdefghij", 16), ["abcd", "efgh", "ij"]);
  const el = createElement("text", { text: "the quick brown fox", font: "tom-thumb", overflow: "wrap" } as any);
  const layout = layoutText(el as any, {}, 40);
  assert.equal(layout.lines.length, 2);
  assert.ok(layout.lines.every((l) => l.width <= 40));
  // Clip mode ignores the box width.
  assert.equal(layoutText({ ...el, overflow: "clip" } as any, {}, 40).lines.length, 1);
});

test("wrap anywhere fills each line to the edge and drops leading spaces", () => {
  const font = getFont("tom-thumb"); // 4px advance
  assert.deepEqual(wrapLine(font, "the quick brown fox", 24, true), ["the qu", "ick br", "own fo", "x"]);
  assert.deepEqual(wrapLine(font, "abc def", 12, true), ["abc", "def"]);
  const el = createElement("text", { text: "the quick brown fox", font: "tom-thumb", overflow: "wrap", wrapMode: "char" } as any);
  assert.equal(layoutText(el as any, {}, 24).lines.length, 4);
});

test("hour fields follow the source's 12-hour setting; H24 and h12 don't", () => {
  const t = Date.UTC(2026, 8, 27, 19, 5, 9); // 19:05 UTC
  const twelve = clockValues("UTC", true, t);
  assert.equal(twelve.HH, "07");
  assert.equal(twelve.h, "7");
  assert.equal(twelve.time, "7:05");
  assert.equal(twelve.H24, "19");
  const day = clockValues("UTC", false, t);
  assert.equal(day.HH, "19");
  assert.equal(day.h12, "7");
});

test("text scale multiplies glyph size, line height and wrapping width", () => {
  const base = createElement("text", { text: "Hi", font: "tom-thumb" } as any) as any;
  const big = { ...base, scale: 3 };
  const a = layoutText(base, {});
  const b = layoutText(big, {});
  assert.equal(b.lines[0].width, a.lines[0].width * 3);
  assert.equal(b.lineHeight, getFont("tom-thumb").lineHeight * 3 + base.lineSpacing);
  // 24px box at 3× holds 8 font px = two 4px characters per line.
  assert.deepEqual(layoutText({ ...big, text: "abcd", overflow: "wrap", wrapMode: "char" }, {}, 24).lines.map((l) => l.text), ["ab", "cd"]);
});

test("every bundled font loads and has digits", () => {
  for (const f of listFonts()) {
    const font = getFont(f.id);
    assert.equal(font.id, f.id);
    for (const ch of "0123456789") assert.ok(FONT_DATA[f.id].glyphs[ch.codePointAt(0)!], `${f.id} missing ${ch}`);
    // ° renders as a real glyph (bundled or synthesised), never the "?" fallback.
    assert.notDeepEqual(font.glyph(0xb0), font.glyph(63), `${f.id} shows ? for °`);
  }
});

test("even icon scales use the detailed 2× art unless blocky", () => {
  const two = iconForScale("sun", 2)!;
  assert.equal(two.icon, ICONS_2X.sun);
  assert.equal(two.k, 1);
  assert.deepEqual([iconForScale("sun", 4)!.icon, iconForScale("sun", 4)!.k], [ICONS_2X.sun, 2]);
  assert.equal(iconForScale("sun", 3)!.k, 3); // odd scales double the 1× art
  assert.equal(iconForScale("sun", 2, true)!.k, 2); // blocky
  assert.equal(iconForScale("nope", 2), null);
  for (const [name, icon] of Object.entries(ICONS_2X)) assert.ok(icon.w <= 64 && icon.h <= 32, `${name} is ${icon.w}×${icon.h}`);
});

test("series and number bindings resolve from scope or literals", () => {
  const scope = { s: { GSPC: { series: [1, 2, null, 3], prevClose: 2.5 }, name: "x" } };
  assert.deepEqual(resolveSeries("{{s.GSPC.series}}", scope), [1, 2, 3]);
  assert.deepEqual(resolveSeries("s.GSPC.series", scope), [1, 2, 3]);
  assert.deepEqual(resolveSeries("3, 5, 4", scope), [3, 5, 4]);
  assert.deepEqual(resolveSeries("{{s.name}}", scope), []);
  assert.equal(resolveNumber("{{s.GSPC.prevClose}}", scope), 2.5);
  assert.equal(resolveNumber("7", scope), 7);
  assert.equal(resolveNumber("{{nope}}", scope), null);
  assert.deepEqual(numericSeriesPaths(scope), ["s.GSPC.series"]);
});

test("sparklines draw a continuous line, colour by trend and reveal over time", () => {
  const slide = createSlide();
  const el = createElement("sparkline", { data: "0, 10, 0", showBaseline: false, showLast: false, state: { x: 0, y: 0, w: 21, h: 11, color: "#3aa0ff", opacity: 1 } } as any) as any;
  slide.elements = [el];
  const litColumns = (f: Uint8ClampedArray) => {
    const cols = new Set<number>();
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (f[(y * 64 + x) * 4 + 1] > 0) cols.add(x);
    return cols;
  };
  const f = renderSlide(slide, 0, {});
  assert.equal(litColumns(f).size, 21); // every column of the box has a pixel
  // Peak in the middle column reaches the top; ends sit on the bottom row.
  assert.ok(f[(0 * 64 + 10) * 4 + 1] > 0);
  assert.ok(f[(10 * 64 + 0) * 4 + 1] > 0);
  // Ends level with the start → "up" (green) in trend mode.
  assert.deepEqual([...f.slice((10 * 64) * 4, (10 * 64) * 4 + 3)], [0x32, 0xd4, 0x6a]);
  // Half way through a 1s reveal, only about half the columns are drawn.
  el.revealMs = 1000;
  assert.equal(litColumns(renderSlide(slide, 500, {})).size, 11);
  // Bars: 1px bars with gaps.
  el.revealMs = 0;
  el.style = "bars";
  el.data = "1, 2, 3, 4";
  assert.equal(litColumns(renderSlide(slide, 0, {})).size, 4);
});

test("ping-pong scrolls to the end, pauses, comes back, pauses and repeats", () => {
  // 100px of text in a 60px box at 20px/s: 40px each way takes 2s; holds are 1s.
  const at = (t: number) => pingPongOffset(t, 100, 60, 20);
  assert.equal(pingPongCycleMs(100, 60, 20), 6000);
  assert.equal(at(500), 0); // holding at the start
  assert.equal(at(2000), 20); // half way out
  assert.equal(at(3000), 40); // at the end
  assert.equal(at(3500), 40); // holding at the end
  assert.equal(at(5000), 20); // half way back
  assert.equal(at(6000), 0); // back at the start: the next cycle begins
  assert.equal(at(8000), 20);
  assert.equal(pingPongOffset(1234, 50, 60, 20), 0); // fits: no movement
});

test("marquee start delay and pauses are adjustable", () => {
  // Ping-pong: 40px each way at 20px/s = 2s; start after 500ms, rest 250ms at the ends.
  const timing = { startMs: 500, pauseMs: 250 };
  const at = (t: number) => pingPongOffset(t, 100, 60, 20, timing);
  assert.equal(at(400), 0);
  assert.equal(at(1500), 20); // half way out
  assert.equal(at(2600), 40); // resting at the end
  assert.equal(at(3750), 20); // half way back
  assert.equal(pingPongCycleMs(100, 60, 20, timing), 500 + 4000 + 250);
  // Loop: a 100px cycle at 50px/s takes 2s, then rests 1s back at the start.
  const loop = { startMs: 0, pauseMs: 1000 };
  assert.equal(loopOffset(1000, 100, 50, loop), 50);
  assert.equal(loopOffset(2500, 100, 50, loop), 0); // resting
  assert.equal(loopOffset(3500, 100, 50, loop), 25); // next lap
  // No pause: it scrolls continuously.
  assert.equal(loopOffset(3500, 100, 50, { startMs: 1000, pauseMs: 0 }), 25);
});

test("wait while animating: the scroll clock stops while keyframes move the element", () => {
  const box = { x: 0, y: 0, w: 30, h: 8, color: "#ffffff", opacity: 1 };
  const el = createElement("text", {
    text: "A long headline that does not fit",
    overflow: "marquee",
    marqueeMode: "once",
    marqueeHoldWhileMoving: true,
    keyframes: [
      { id: "a", t: 0, easing: "linear", state: { ...box, x: -30 } }, // 1s intro
      { id: "b", t: 1000, easing: "easeOutCubic", state: box },
      { id: "c", t: 8000, easing: "linear", state: box },
      { id: "d", t: 9000, easing: "linear", state: { ...box, y: 40 } }, // 1s exit
      { id: "e", t: 9500, easing: "step", state: { ...box, y: 40, opacity: 0 } }, // a jump, not a move
    ],
  });
  assert.deepEqual(movingSpans(el), [[0, 1000], [8000, 9000]]);
  assert.equal(scrollClock(el, 500), 0);
  assert.equal(scrollClock(el, 2000), 1000); // intro done, then 1s of scroll time
  assert.equal(scrollClock(el, 8500), 7000); // frozen during the exit
  assert.equal(scrollClock(el, 9800), 7800);
  assert.equal(slideTimeAt(el, 1000), 2000); // the 1s start delay runs after the intro
  assert.equal(slideTimeAt(el, 7500), 9500);
  for (const t of [1500, 4000, 9700]) assert.equal(slideTimeAt(el, scrollClock(el, t)), t); // inverses while still
  // Rendering: nothing scrolls until 2s in, where the default start delay ends.
  const s = createSlide();
  s.elements = [el];
  assert.deepEqual(renderSlide(s, 1200, {}), renderSlide(s, 1990, {}));
  assert.notDeepEqual(renderSlide(s, 1990, {}), renderSlide(s, 3000, {}));
  // Without the option the same text starts scrolling at 1s, during the intro's hold.
  el.marqueeHoldWhileMoving = false;
  assert.notDeepEqual(renderSlide(s, 1200, {}), renderSlide(s, 1990, {}));
});

test("special spaces from macOS times render as spaces, not ?", () => {
  for (const id of ["tb-8", "5x8", "tom-thumb", "terminus-20b"]) {
    const font = getFont(id);
    const space = font.glyph(32)!;
    for (const cp of [0x202f, 0x00a0, 0x2009]) {
      const g = font.glyph(cp)!;
      // U+00A0 is in Latin-1, so some fonts draw their own (blank) one; the others fall back to space.
      if (cp !== 0x00a0) assert.equal(g.advance, space.advance, `${id} U+${cp.toString(16)} width`);
      assert.ok(g.bits.every((b) => b === 0), `${id} U+${cp.toString(16)} is blank`);
    }
  }
});

test("Cyrillic fonts draw Russian and Ukrainian text, never ?", () => {
  const text = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюяЁёЪъЫыЭэ";
  const cyrillic = ["tb-8", "5x8", "6x10", "6x13", "7x13B", "9x15B", "9x18B", "10x20", "terminus-16b", "terminus-32b", "spleen-16", "spleen-32"];
  for (const id of cyrillic) {
    const font = getFont(id);
    const unknown = font.glyph(63);
    for (const ch of text) assert.notDeepEqual(font.glyph(ch.codePointAt(0)!), unknown, `${id} shows ? for ${ch}`);
  }
  // Spleen's missing Є/є borrow the Latin shapes.
  assert.deepEqual(getFont("spleen-16").glyph(0x0404), getFont("spleen-16").glyph(69));
});

test("the clock knows day from night: by sunrise and sunset with a place, else 6:00 to 18:00", () => {
  // London, midsummer 2024: sunrise 04:43 and sunset 21:21 BST.
  const london = { lat: 51.5074, lon: -0.1278 };
  const june = Date.UTC(2024, 5, 21, 12);
  const c = clockValues("Europe/London", false, june, london);
  assert.deepEqual([c.isDay, c.dayNight, c.icon], [true, "day", "sun"]);
  const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  assert.ok(Math.abs(mins(c.sunrise) - mins("04:43")) <= 3, c.sunrise);
  assert.ok(Math.abs(mins(c.sunset) - mins("21:21")) <= 3, c.sunset);
  assert.equal(clockValues("Europe/London", false, Date.UTC(2024, 5, 21, 20, 0), london).isDay, true); // 21:00 BST
  assert.equal(clockValues("Europe/London", false, Date.UTC(2024, 5, 21, 20, 40), london).icon, "moon"); // 21:40 BST
  // New York, midwinter, in 12-hour time: sunrise 7:16, sunset 4:32.
  const ny = clockValues("America/New_York", true, Date.UTC(2024, 11, 21, 17), { lat: 40.7128, lon: -74.006 });
  assert.ok(/^7:1\d$/.test(ny.sunrise) && /^4:3\d$/.test(ny.sunset), `${ny.sunrise} ${ny.sunset}`);
  // Midnight sun in Tromsø: day all day, with no sunrise or sunset.
  const polar = clockValues("Europe/Oslo", false, Date.UTC(2024, 5, 21, 23), { lat: 69.65, lon: 18.96 });
  assert.deepEqual([polar.isDay, polar.sunrise, polar.sunset], [true, "", ""]);
  // No place: day from 6:00 to 18:00 local.
  assert.equal(clockValues("UTC", false, Date.UTC(2024, 0, 1, 5, 59)).icon, "moon");
  assert.equal(clockValues("UTC", false, Date.UTC(2024, 0, 1, 6)).icon, "sun");
  assert.equal(clockValues("UTC", false, Date.UTC(2024, 0, 1, 18)).dayNight, "night");
});

test("a new project starts with the starter deck, every id its own", () => {
  const a = createProject("UTC");
  const b = createProject("UTC");
  const ids = (p: unknown) => JSON.stringify(p).match(/"id":"[^"]+"/g)!;
  assert.equal(new Set(ids(a)).size, ids(a).length, "no id repeats within a project");
  assert.ok(!ids(a).some((id) => ids(b).includes(id)), "two projects share none");
  const deck = a.decks[0];
  assert.deepEqual(
    deck.items.map((i) => [a.slides.find((s) => s.id === i.slideId)!.name, i.showIf ?? ""]),
    [["Clock", ""], ["Weather", "{{weather.condition}}"], ["Stocks", ""], ["News", "{{gnews.count}}"], ["Calendar", "{{calendar.hasEvents}}"]],
  );
  for (const s of a.slides) assert.doesNotThrow(() => renderSlide(s, 2000, {}), s.name);
});
