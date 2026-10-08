import { motionSpans, snapState, stateAt, type Clock } from "../../shared/animate";
import { hasBindings, resolveTemplate, type Scope } from "../../shared/bindings";
import { parseColor } from "../../shared/color";
import { getFont, measureLine, type Font } from "../../shared/fonts";
import type { Painter } from "../../shared/painter";
import type { AnimState, ElementBase } from "../../shared/types";
import type { ElementDef } from "../types";

export type TextAlign = "left" | "center" | "right";
export type TextOverflow = "clip" | "wrap" | "marquee";

export interface TextElement extends ElementBase {
  type: "text";
  /** May contain {{source.path|filter}} bindings. */
  text: string;
  font: string;
  align: TextAlign;
  valign: "top" | "middle" | "bottom";
  overflow: TextOverflow;
  /** Pixels per second when overflow is "marquee". */
  marqueeSpeed: number;
  /**
   * "loop" wraps the text around continuously; "once" scrolls until the last
   * character reaches the box's right edge, then holds; "pingpong" scrolls to
   * that end, pauses, scrolls back to the start, pauses, and repeats.
   * Missing means "loop".
   */
  marqueeMode?: "loop" | "once" | "pingpong";
  /**
   * "left" (the default) scrolls each line sideways. "up" rolls it like film
   * credits: the text wraps to the box's width and scrolls up, so "once" ends
   * with the last line at the bottom of the box.
   */
  marqueeDirection?: "left" | "up";
  /** How long to wait before scrolling starts, in ms of scroll time. Missing means 1000. */
  marqueeDelayMs?: number;
  /**
   * Ping-pong: the pause at each end. Loop: a pause each time the text comes
   * back round to the start. Missing means 1000 for ping-pong, 0 for loop.
   */
  marqueePauseMs?: number;
  /**
   * Only scroll while the element is still: keyframed moves (an intro, an
   * exit) pause the scroll and don't count towards the start delay.
   */
  marqueeHoldWhileMoving?: boolean;
  /**
   * "Once", on a fixed-length timeline: fill the time instead of moving at
   * marqueeSpeed, finishing restMs before the outro line (or the end), whatever
   * the text. Each line gets its own speed. On a fitted timeline (in a Hold)
   * text always scrolls at its speed, and the Hold lasts as long as that takes.
   */
  marqueeFill?: boolean;
  /** The fastest a filling scroll may go, so long text stays readable (px/s). Missing means 40. */
  marqueeMaxSpeed?: number;
  /** "Once": how long it stays still after it finishes, so it can be read (ms). Missing means 1500. */
  marqueeRestMs?: number;
  /** Draw each font pixel as an n×n block (1–4). Missing means 1. */
  scale?: number;
  /** With overflow "wrap": break at spaces ("word", the default) or at any character. */
  wrapMode?: "word" | "char";
  /** Extra pixels between lines. */
  lineSpacing: number;
}

/* ---------------- layout ---------------- */

export interface TextLayout {
  lines: { text: string; width: number }[];
  lineHeight: number;
  blockHeight: number;
}

/**
 * Breaks one line into lines no wider than maxW. By word: at spaces, or
 * mid-word if a word alone is too wide. Anywhere: fill each line to the edge.
 */
export function wrapLine(font: Font, text: string, maxW: number, anywhere = false): string[] {
  const out: string[] = [];
  let cur = "";
  if (anywhere) {
    for (const ch of text) {
      if (cur && measureLine(font, cur + ch) > maxW) {
        out.push(cur);
        cur = "";
      }
      if (!cur && ch === " " && out.length) continue; // no leading space on a wrapped line
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  for (const word of text.split(" ")) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (measureLine(font, candidate) <= maxW) {
      cur = candidate;
      continue;
    }
    if (cur) out.push(cur);
    cur = "";
    for (const ch of word) {
      if (cur && measureLine(font, cur + ch) > maxW) {
        out.push(cur);
        cur = "";
      }
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function textScale(el: TextElement) {
  return Math.max(1, Math.min(4, Math.round(el.scale ?? 1)));
}

/** Scrolling up, credits style (see marqueeDirection). */
export function scrollsUp(el: Pick<TextElement, "overflow" | "marqueeDirection">) {
  return el.overflow === "marquee" && el.marqueeDirection === "up";
}

/** Lays out text; with overflow "wrap" (or scrolling up), `boxWidth` is the width lines wrap to. */
export function layoutText(el: TextElement, scope: Scope, boxWidth?: number): TextLayout {
  const font = getFont(el.font);
  const k = textScale(el);
  const text = resolveTemplate(el.text, scope);
  let raw = text.split("\n");
  // Wrap in unscaled font units, then scale the results. Credits-style scrolling wraps too.
  if ((el.overflow === "wrap" || scrollsUp(el)) && boxWidth && boxWidth > 0) raw = raw.flatMap((l) => wrapLine(font, l, Math.floor(boxWidth / k), el.wrapMode === "char"));
  const lines = raw.map((t) => ({ text: t, width: measureLine(font, t) * k }));
  const lineHeight = font.lineHeight * k + el.lineSpacing;
  return { lines, lineHeight, blockHeight: lines.length * lineHeight - el.lineSpacing };
}

/** The box the text needs. Wrapped text keeps its width and only needs height. */
export function textBoxSize(el: TextElement, scope: Scope) {
  // Rolling up, the box is the window it rolls through: sizing it to the text would stop the scroll.
  if (scrollsUp(el)) return { w: el.state.w, h: el.state.h };
  const l = layoutText(el, scope, el.state.w);
  const h = Math.max(getFont(el.font).lineHeight * textScale(el), l.blockHeight);
  if (el.overflow === "wrap") return { w: el.state.w, h };
  return { w: Math.max(1, ...l.lines.map((x) => x.width)), h };
}

/** Grows the box so unbound text isn't clipped after an edit. */
export function growTextToFit(el: TextElement, scope: Scope) {
  if (el.overflow === "marquee" || hasBindings(el.text)) return;
  const size = textBoxSize(el, scope);
  const grow = (s: AnimState) => {
    s.w = Math.max(s.w, size.w);
    s.h = Math.max(s.h, size.h);
  };
  grow(el.state);
  el.keyframes.forEach((k) => grow(k.state));
}

/* ---------------- marquee timing ---------------- */

// Scrolling runs on a "scroll clock": normally the slide's own time, but with
// marqueeHoldWhileMoving it stops while the element's keyframes move it.
// Every time below is in scroll-clock ms unless it says otherwise.

export const MARQUEE_PAUSE_MS = 1000;

export interface MarqueeTiming {
  /** Wait before the first scroll. */
  startMs: number;
  /** Ping-pong: rest at each end. Loop: rest each time the text is back at the start. */
  pauseMs: number;
}

const DEFAULT_TIMING: MarqueeTiming = { startMs: MARQUEE_PAUSE_MS, pauseMs: MARQUEE_PAUSE_MS };

export function marqueeTiming(el: TextElement): MarqueeTiming {
  const pause = el.marqueeMode === "pingpong" ? MARQUEE_PAUSE_MS : 0;
  return { startMs: Math.max(0, el.marqueeDelayMs ?? MARQUEE_PAUSE_MS), pauseMs: Math.max(0, el.marqueePauseMs ?? pause) };
}

/**
 * Slide-time spans where keyframes move the element: its position, size or
 * opacity changing. Colour changes don't count, and neither do "step" keys,
 * which jump rather than move.
 */
export function movingSpans(el: ElementBase): [number, number][] {
  return motionSpans(el, ["position", "size", "opacity"]);
}

/** The scroll clock at slide time t. */
export function scrollClock(el: TextElement, t: number): number {
  if (!el.marqueeHoldWhileMoving) return t;
  let c = t;
  for (const [a, b] of movingSpans(el)) if (a < t) c -= Math.min(t, b) - a;
  return c;
}

/** The slide time when the scroll clock reaches c: the inverse of scrollClock. */
export function slideTimeAt(el: TextElement, c: number): number {
  if (!el.marqueeHoldWhileMoving) return c;
  let t = c;
  for (const [a, b] of movingSpans(el)) if (a < t) t += b - a;
  return t;
}

/** Scroll time to cover the overflow once. */
function travelMs(lineWidth: number, boxWidth: number, speed: number) {
  return (Math.max(0, lineWidth - boxWidth) / Math.max(1, speed)) * 1000;
}

/** One full "pingpong" round trip from the start: wait, scroll to the end, pause, scroll back. */
export function pingPongCycleMs(lineWidth: number, boxWidth: number, speed: number, timing = DEFAULT_TIMING) {
  return timing.startMs + 2 * travelMs(lineWidth, boxWidth, speed) + timing.pauseMs;
}

/** How far a "pingpong" marquee has scrolled at scroll time t. */
export function pingPongOffset(t: number, lineWidth: number, boxWidth: number, speed: number, timing = DEFAULT_TIMING) {
  const distance = Math.max(0, lineWidth - boxWidth);
  if (!distance) return 0;
  const travel = travelMs(lineWidth, boxWidth, speed);
  const phase = t - timing.startMs;
  if (phase < 0) return 0;
  const p = phase % (2 * travel + 2 * timing.pauseMs);
  if (p < travel) return Math.round((p / travel) * distance);
  if (p < travel + timing.pauseMs) return distance;
  if (p < 2 * travel + timing.pauseMs) return Math.round(distance - ((p - travel - timing.pauseMs) / travel) * distance);
  return 0;
}

/** How far a "loop" marquee has scrolled at scroll time t, for text that repeats every `cycle` px. */
export function loopOffset(t: number, cycle: number, speed: number, timing: MarqueeTiming) {
  const phase = Math.max(0, t - timing.startMs);
  if (!timing.pauseMs) return Math.floor((phase * (speed / 1000)) % cycle);
  const travel = (cycle / Math.max(1, speed)) * 1000;
  const p = phase % (travel + timing.pauseMs);
  return p < travel ? Math.floor(p * (speed / 1000)) : 0;
}

/** When a "once" marquee finishes scrolling, in scroll time. */
export function marqueeEndMs(lineWidth: number, boxWidth: number, speed: number, startMs = MARQUEE_PAUSE_MS) {
  return startMs + travelMs(lineWidth, boxWidth, speed);
}

export const DEFAULT_MAX_SPEED = 40;

/** How long a "once" marquee stays still after it finishes, so it can be read. */
export function restMs(el: Pick<TextElement, "marqueeRestMs">) {
  return Math.max(0, el.marqueeRestMs ?? MARQUEE_READ_MS);
}

/**
 * When a "once" scroll filling the time should finish (scroll time): its rest
 * before the outro line, or the end, of this timeline. Null when it scrolls at
 * its speed: it doesn't fill, or the timeline is fitted (a Hold), where the
 * Hold lasts as long as the scroll takes instead. Keys must be resolved for `clock`.
 */
export function fillFinishMs(el: TextElement, clock?: Clock): number | null {
  if (!el.marqueeFill || el.marqueeMode !== "once" || !clock || clock.hold) return null;
  return scrollClock(el, clock.end - clock.outroMs) - restMs(el);
}

/**
 * The speed a "once" line scrolls at: marqueeSpeed, or filling the time on
 * `clock`, whatever covers this line's overflow by then, up to the readable cap.
 */
export function onceSpeed(el: TextElement, lineWidth: number, boxWidth: number, clock?: Clock) {
  const finish = fillFinishMs(el, clock);
  if (finish == null) return el.marqueeSpeed;
  const distance = Math.max(0, lineWidth - boxWidth);
  const cap = Math.max(1, el.marqueeMaxSpeed ?? DEFAULT_MAX_SPEED);
  return Math.min(cap, Math.max(1, (distance / Math.max(1, finish - marqueeTiming(el).startMs)) * 1000));
}

/** When a "once" marquee of this width really finishes (scroll time): later than planned if the cap slowed it. */
export function onceEndMs(el: TextElement, lineWidth: number, boxWidth: number, clock?: Clock) {
  return marqueeEndMs(lineWidth, boxWidth, onceSpeed(el, lineWidth, boxWidth, clock), marqueeTiming(el).startMs);
}

/**
 * How far the text runs along its scroll, and the room it has, as the box is
 * when scrolling starts: sideways, its widest line against the box's width;
 * scrolling up, the wrapped text's height against the box's.
 */
export function scrollExtent(el: TextElement, scope: Scope): { content: number; box: number } {
  const s = snapState(stateAt(el, slideTimeAt(el, marqueeTiming(el).startMs)));
  if (scrollsUp(el)) return { content: layoutText(el, scope, s.w).blockHeight, box: s.h };
  return { content: Math.max(0, ...layoutText(el, scope).lines.map((l) => l.width)), box: s.w };
}

/** How long a "once" marquee is left up after it finishes, so it can be read, unless it says (see restMs). */
export const MARQUEE_READ_MS = 1500;

/* ---------------- drawing ---------------- */

/** Draws a line of text with its baseline at `baseline`; k scales every font pixel to a k×k block. */
function drawString(p: Painter, font: Font, text: string, x: number, baseline: number, rgb: number[], a: number, k = 1) {
  let pen = x;
  for (const ch of text) {
    const g = font.glyph(ch.codePointAt(0)!);
    if (!g) continue;
    const left = pen + g.xoff * k;
    const top = baseline - (g.yoff + g.h) * k;
    for (let gy = 0; gy < g.h; gy++)
      for (let gx = 0; gx < g.w; gx++) {
        if (!g.bits[gy * g.w + gx]) continue;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) p.px(left + gx * k + dx, top + gy * k + dy, rgb[0], rgb[1], rgb[2], a);
      }
    pen += g.advance * k;
  }
}

/**
 * The scroll clock at time t: inside a rotator item it runs from the start of
 * the Hold (the In and Out are for animation); elsewhere, see scrollClock.
 */
export function scrollTime(el: TextElement, t: number, hold?: [number, number]) {
  return hold ? Math.max(0, t - hold[0]) : scrollClock(el, t);
}

/** Draws text at time t on the timeline `timeline` (its Hold, if any, times the scroll; its end, a "once" scroll that fills it). */
function drawText(p: Painter, el: TextElement, s: AnimState, t: number, scope: Scope, timeline?: Clock) {
  const font = getFont(el.font);
  const layout = layoutText(el, scope, s.w);
  const k = textScale(el);
  const rgb = parseColor(s.color);
  const box = p.box(s);
  const draw = (text: string, x: number, baseline: number) => drawString(box, font, text, x, baseline, rgb, s.opacity, k);
  let top = s.y;
  if (el.valign === "middle") top = s.y + Math.floor((s.h - layout.blockHeight) / 2);
  else if (el.valign === "bottom") top = s.y + s.h - layout.blockHeight;
  const scrolling = el.overflow === "marquee";
  const clock = scrolling ? scrollTime(el, t, timeline?.hold) : t;
  const timing = marqueeTiming(el);
  /** One line where its alignment puts it, `top` being the block's top. */
  const placed = (line: { text: string; width: number }, i: number, blockTop: number) => {
    let x = s.x;
    if (el.align === "center") x = s.x + Math.floor((s.w - line.width) / 2);
    else if (el.align === "right") x = s.x + s.w - line.width;
    draw(line.text, x, blockTop + i * layout.lineHeight + font.ascent * k);
  };
  if (scrollsUp(el) && layout.blockHeight > s.h) {
    // Credits: the whole block moves up, by the same timings as a sideways scroll.
    const h = layout.blockHeight;
    let off: number;
    if (el.marqueeMode === "pingpong") off = pingPongOffset(clock, h, s.h, el.marqueeSpeed, timing);
    else if (el.marqueeMode === "once") off = Math.min(h - s.h, Math.floor(Math.max(0, clock - timing.startMs) * (onceSpeed(el, h, s.h, timeline) / 1000)));
    else {
      // Round again after a gap of half the box, so the end doesn't run into the start.
      const cycle = h + Math.max(layout.lineHeight, Math.ceil(s.h / 2));
      off = loopOffset(clock, cycle, el.marqueeSpeed, timing);
      layout.lines.forEach((line, i) => placed(line, i, s.y - off + cycle));
    }
    layout.lines.forEach((line, i) => placed(line, i, s.y - off));
    return;
  }
  layout.lines.forEach((line, i) => {
    const baseline = top + i * layout.lineHeight + font.ascent * k;
    if (scrolling && !scrollsUp(el) && line.width > s.w && el.marqueeMode === "pingpong") {
      draw(line.text, s.x - pingPongOffset(clock, line.width, s.w, el.marqueeSpeed, timing), baseline);
      return;
    }
    if (scrolling && !scrollsUp(el) && line.width > s.w && el.marqueeMode === "once") {
      // Scroll until the text's right end meets the box's right edge, then hold.
      const moved = Math.max(0, clock - timing.startMs) * (onceSpeed(el, line.width, s.w, timeline) / 1000);
      draw(line.text, s.x - Math.min(line.width - s.w, Math.floor(moved)), baseline);
      return;
    }
    if (scrolling && !scrollsUp(el) && line.width > s.w) {
      const gap = Math.max(12, Math.floor(s.w / 2));
      const cycle = line.width + gap;
      const off = loopOffset(clock, cycle, el.marqueeSpeed, timing);
      draw(line.text, s.x - off, baseline);
      draw(line.text, s.x - off + cycle, baseline);
      return;
    }
    placed(line, i, top);
  });
}

export const textElement: ElementDef<TextElement> = {
  type: "text",
  label: "Text",
  group: "content",
  icon: "M3.5 3.5h9 M8 3.5v9.5",
  create() {
    const font = getFont("tb-8");
    return {
      text: "Hello",
      font: font.id,
      align: "left",
      valign: "top",
      overflow: "clip",
      marqueeSpeed: 20,
      marqueeMode: "loop",
      lineSpacing: 1,
      state: { x: 2, y: 2, w: measureLine(font, "Hello") + 1, h: font.lineHeight, color: "#ffffff", opacity: 1 },
    };
  },
  draw: (p, el, s, { t, scope, clock }) => drawText(p, el, s, t, scope, clock),
  bindable: ["text"],
  minDurationMs(el, scope) {
    if (el.overflow !== "marquee" || el.marqueeMode !== "once") return 0;
    const { content, box } = scrollExtent(el, scope);
    if (content <= box) return 0; // fits: nothing to wait for
    // At its speed: in a Hold that's how it scrolls; on a fixed timeline, how long it'd like.
    return slideTimeAt(el, onceEndMs(el, content, box)) + restMs(el);
  },
};
