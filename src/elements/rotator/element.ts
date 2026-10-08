import { listPaths, lookup, unwrap, type Scope } from "../../shared/bindings";
import { ease } from "../../shared/easing";
import { uid } from "../../shared/id";
import type { Clock } from "../../shared/animate";
import { fittedMs, phasesOf, timingClock, type Timing } from "../../shared/timing";
import type { EasingName, ElementBase } from "../../shared/types";
import type { SlideElement } from "../index";
import { textElement, type TextElement } from "../text/element";
import type { ElementDef, Measure } from "../types";

/**
 * A container that shows its children once per item of a list, one item at a
 * time: each item's children see {{item.*}}, {{index}} and {{count}}, and run
 * on their own clock from the item's start. The whole layout changes over
 * together (push, fade or cut).
 *
 * Each item is timed like a slide (see Timing): a fixed length (lengthMs),
 * keyed anywhere, with an optional outro line; or fit to its content, in
 * three phases: In (inMs, keyed from its start), Hold (as long as the item
 * needs: its text scrolling, then a moment to read) and Out (outMs, keyed from
 * its end). In and Out are the same length for every item, so their animation
 * is too; only the Hold, which has no keys, varies.
 */
export interface RotatorElement extends ElementBase, Timing {
  type: "rotator";
  /** A binding to a list, e.g. {{rss.items}} or {{calendar.events}}. */
  list: string;
  /** The item layout: children positioned relative to the rotator's top-left. */
  children: SlideElement[];
  /** With a fixed length: how long each item is up (ms). */
  lengthMs?: number;
  transition: "push-up" | "push-left" | "fade" | "cut";
  transitionMs: number;
  transitionEasing: EasingName;
  /** Show at most this many items; 0 means all of them. */
  maxItems: number;
  /** Shown (in the rotator's colour) when the list is empty or missing. */
  emptyText: string;
  /** After the last item, start over from the first (the default); false stays on the last. */
  loop?: boolean;
  /**
   * Show only this many items each time the slide plays, carrying on from
   * where the last showing left off (and round to the first after the last).
   * 0 or missing: every item, every time.
   */
  perPlay?: number;
}

/**
 * Which showing of its slide this is (0, 1, 2…), for rotators that show a few
 * items each time. The server counts its slides' showings and passes the
 * count in the scope as `$play`; the editor uses the one it's previewing.
 */
export function playNumber(scope: Scope): number {
  const n = Number((scope as Record<string, unknown>).$play);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The items showing number `play` plays, in order (their places in the list). */
export function playOrder(el: Pick<RotatorElement, "perPlay">, count: number, play: number): number[] {
  const k = Math.max(0, Math.floor(el.perPlay ?? 0));
  if (!k || k >= count) return Array.from({ length: count }, (_, i) => i);
  const start = (play * k) % count;
  return Array.from({ length: k }, (_, j) => (start + j) % count);
}

/** A value the image element can draw: {srcW, srcH, data}. */
export function isBitmap(v: unknown): boolean {
  return !!v && typeof v === "object" && typeof (v as { data?: unknown }).data === "string" && Number((v as { srcW?: unknown }).srcW) > 0;
}

export function rotatorItems(el: RotatorElement, scope: Scope): unknown[] {
  const v = lookup(scope, unwrap(el.list));
  if (!Array.isArray(v)) return [];
  return el.maxItems > 0 ? v.slice(0, el.maxItems) : v;
}

/** The scope an item's children see: the slide's, plus item, index (1-based) and count. */
export function itemScope(scope: Scope, items: unknown[], i: number): Scope {
  return { ...scope, item: items[i], index: i + 1, count: items.length };
}

/** The shortest an item can be up (ms), so a rotator always moves along. */
export const MIN_ITEM_MS = 200;
/** A fixed-length item's length when none is set (ms). */
export const DEFAULT_ITEM_MS = 5000;

/** A fixed-length item's length (ms). */
export function itemLength(el: Pick<RotatorElement, "lengthMs">) {
  return Math.max(MIN_ITEM_MS, Math.round(el.lengthMs ?? DEFAULT_ITEM_MS));
}

/**
 * How long each item is up (ms), in order. Fixed, every item is lengthMs.
 * Fitted, each is its In, a Hold as long as its content needs (measured as it
 * stands at the end of the In) but at least holdMs, and its Out.
 */
export function rotatorSchedule(el: RotatorElement, scope: Scope, measure: Pick<Measure, "holdNeedMs">, items = rotatorItems(el, scope)): number[] {
  if (!el.fit) return items.map(() => itemLength(el));
  const { inMs } = phasesOf(el);
  return items.map((_, i) => Math.max(MIN_ITEM_MS, fittedMs(el, measure.holdNeedMs(el.children, itemScope(scope, items, i), inMs))));
}

/** One item's time on screen: which item, from when to when (in the rotator's time). */
export interface Turn {
  i: number;
  start: number;
  end: number;
}

/**
 * The items' turns on a timeline `parentEnd` ms long: in order, round again if
 * looping. An item that couldn't finish before the timeline ends doesn't
 * start; the one before holds on instead, so every Out plays in full. Without
 * looping, the last item holds on to the end the same way.
 */
export function rotatorTurns(el: Pick<RotatorElement, "loop" | "perPlay">, durations: number[], parentEnd: number, play = 0): Turn[] {
  const turns: Turn[] = [];
  if (!durations.length) return turns;
  // This showing's items: all of them (round again if looping), or the next few, once.
  const order = playOrder(el, durations.length, play);
  const once = el.loop === false || order.length < durations.length;
  let t = 0;
  for (let n = 0; n < 5000 && t < parentEnd; n++) {
    if (once && n >= order.length) break;
    const i = order[n % order.length];
    const d = durations[i];
    if (turns.length && t + d > parentEnd + 1) break;
    turns.push({ i, start: t, end: t + d });
    t += d;
  }
  const last = turns[turns.length - 1];
  last.end = Math.max(last.end, parentEnd);
  return turns;
}

/** The turn at time t (the first one before it starts). */
export function turnAt(turns: Turn[], t: number): number {
  let k = 0;
  while (k < turns.length - 1 && t >= turns[k + 1].start) k++;
  return k;
}

/** An item's own timeline for a turn: its length, and its outro line or (fitted) its In, Hold and Out. */
export function itemClock(el: Timing, turn: Pick<Turn, "start" | "end">): Clock {
  return timingClock(el, turn.end - turn.start);
}

/** An item's length when it isn't up anywhere (an empty list): its fixed length, or fitted, its set phases. */
export function nominalItemMs(el: RotatorElement) {
  return el.fit ? Math.max(MIN_ITEM_MS, fittedMs(el, 0)) : itemLength(el);
}

/**
 * Item i's first turn on a timeline `parentEnd` ms long; one that never comes
 * up there (the slide's too short) still gets its turn, as if it had.
 */
export function firstTurn(el: RotatorElement, durations: number[], i: number, parentEnd: number, play = 0): Turn {
  const hit = rotatorTurns(el, durations, parentEnd, play).find((t) => t.i === i);
  if (hit) return hit;
  const start = durations.slice(0, i).reduce((a, b) => a + b, 0);
  return { i, start, end: start + durations[i] };
}

/** The text shown for an empty list: plain TB-8 in the rotator's box and colour. */
function emptyTextElement(el: RotatorElement): TextElement {
  return { ...(textElement.create() as Omit<TextElement, "id" | "type" | "name" | "keyframes">), id: `${el.id}-empty`, type: "text", name: "Empty", text: el.emptyText, valign: "middle", keyframes: [], state: el.state };
}

export const rotatorElement: ElementDef<RotatorElement> = {
  type: "rotator",
  label: "Rotator",
  group: "container",
  icon: "M2.5 4h8 M2.5 8h11 M2.5 12h6 M12.5 1.8v4.4 M10.8 4.4l1.7 1.8 1.7-1.8",
  create(scope = {}) {
    // Start on the first list in the data: its items' titles, and a small image per item if they have one.
    const path = listPaths(scope)[0];
    const first = path ? (lookup(scope, path) as unknown[])[0] : undefined;
    const rec = first && typeof first === "object" ? (first as Record<string, unknown>) : null;
    const field = rec ? (["title", "name", "text"].find((k) => k in rec) ?? Object.keys(rec)[0]) : null;
    const bitmap = rec ? ["favicon8", "icon", "favicon", "image"].find((k) => isBitmap(rec[k])) : undefined;
    const h = 9;
    const children: SlideElement[] = [];
    if (bitmap)
      children.push({ id: uid("el_"), type: "image", name: "Image", src: `{{item.${bitmap}}}`, srcW: 1, srcH: 1, data: "", tint: false, keyframes: [], state: { x: 0, y: 0, w: 8, h: 8, color: "#ffffff", opacity: 1 } });
    const x = bitmap ? 10 : 0;
    children.push({
      ...(textElement.create() as Omit<TextElement, "id" | "type" | "name" | "keyframes">),
      id: uid("el_"),
      type: "text",
      name: "Text",
      keyframes: [],
      text: field ? `{{item.${field}}}` : "{{item}}",
      valign: "middle",
      overflow: "marquee",
      marqueeMode: "once",
      state: { x, y: 0, w: 64 - x, h, color: "#ffffff", opacity: 1 },
    });
    return {
      list: path ? `{{${path}}}` : "",
      children,
      fit: true,
      holdMs: 4000,
      transition: "push-up",
      transitionMs: 350,
      transitionEasing: "easeOutCubic",
      maxItems: 0,
      emptyText: "",
      loop: true,
      state: { x: 0, y: 12, w: 64, h, color: "#ffffff", opacity: 1 },
    };
  },
  draw(p, el, s, ctx) {
    const clip = p.box(s);
    const items = rotatorItems(el, ctx.scope);
    if (!items.length) {
      if (el.emptyText) textElement.draw(clip, emptyTextElement(el), s, ctx);
      return;
    }
    const durations = rotatorSchedule(el, ctx.scope, ctx, items);
    const turns = rotatorTurns(el, durations, ctx.clock.end, playNumber(ctx.scope));
    const k = turnAt(turns, ctx.t);
    const turn = turns[k];
    const local = ctx.t - turn.start;
    // An item's whole layout, offset (for pushes) and faded as one, on its own timeline.
    const drawItem = (tn: Turn, dx: number, dy: number, alpha: number, at: number) => {
      const inner = clip.translate(s.x + dx, s.y + dy).fade(s.opacity * alpha);
      const sc = itemScope(ctx.scope, items, tn.i);
      const clock = itemClock(el, tn);
      for (const child of el.children) ctx.draw(inner, child, at, sc, clock);
    };

    // Entering: the previous item makes way over the first transitionMs of this one's turn.
    if (el.transition === "cut" || k === 0 || local >= el.transitionMs) return drawItem(turn, 0, 0, 1, local);
    const prev = turns[k - 1];
    const e = ease(el.transitionEasing, local / Math.max(1, el.transitionMs));
    const prevAt = prev.end - prev.start + local; // the outgoing item carries on from where it was
    if (el.transition === "fade") {
      drawItem(prev, 0, 0, 1 - e, prevAt);
      drawItem(turn, 0, 0, e, local);
    } else if (el.transition === "push-up") {
      const dy = Math.round(e * s.h);
      drawItem(prev, 0, -dy, 1, prevAt);
      drawItem(turn, 0, s.h - dy, 1, local);
    } else {
      const dx = Math.round(e * s.w);
      drawItem(prev, -dx, 0, 1, prevAt);
      drawItem(turn, s.w - dx, 0, 1, local);
    }
  },
  // One pass through this showing's items, so a slide fitted to its content shows them all.
  minDurationMs(el, scope, measure) {
    const durations = rotatorSchedule(el, scope, measure);
    return playOrder(el, durations.length, playNumber(scope)).reduce((a, i) => a + durations[i], 0);
  },
  ownClock: true,
  bindable: ["list", "emptyText"],
};
