import { mixColor } from "./color";
import { ease } from "./easing";
import { uid } from "./id";
import type { AnimState, Channel, ElementBase, Keyframe } from "./types";

export function sortedKeyframes(kfs: Keyframe[]): Keyframe[] {
  return [...kfs].sort((a, b) => a.t - b.t);
}

/* ---------------- channels ---------------- */

// An element's state animates in four channels. Keyed "together" (the
// default), every keyframe keys all of them; keyed "separately", each keyframe
// keys one channel, so e.g. a fade can run on its own timing from a slide-in.

export const CHANNELS: Channel[] = ["position", "size", "color", "opacity"];

export const CHANNEL_FIELDS: Record<Channel, readonly (keyof AnimState)[]> = {
  position: ["x", "y"],
  size: ["w", "h"],
  color: ["color"],
  opacity: ["opacity"],
};

export const CHANNEL_LABELS: Record<Channel, string> = { position: "Position", size: "Size", color: "Colour", opacity: "Opacity" };

export function channelOf(field: keyof AnimState): Channel {
  return CHANNELS.find((c) => CHANNEL_FIELDS[c].includes(field))!;
}

/** Whether keyframe k keys channel c (a keyframe without a channel keys them all). */
export function keysChannel(k: Keyframe, c: Channel) {
  return !k.channel || k.channel === c;
}

/** The keyframes that animate channel c, in time order. */
export function keysFor(el: Pick<ElementBase, "keyframes">, c: Channel): Keyframe[] {
  return sortedKeyframes(el.keyframes.filter((k) => keysChannel(k, c)));
}

export function isSeparate(el: Pick<ElementBase, "keyMode">) {
  return el.keyMode === "separate";
}

/* ---------------- end-anchored keys ---------------- */

// A timeline (the slide's, or a rotator item's) can have an outro: keys in it
// are saved counting back from the end (`fromEnd`), so an exit keeps its place
// when the slide's length changes, or items come out different lengths.
// Everything that plays or measures keys works on "resolved" copies, with
// every key at its time in a timeline of a known length.
//
// A rotator item's timeline has three phases: In (keys from the start), a Hold
// whose length depends on the item (text scrolling, say) and holds no keys,
// and Out (keys from the end).

/** A timeline: its length, its outro (ms before the end; 0 for none) and, for rotator items, the Hold between In and Out. */
export interface Clock {
  end: number;
  outroMs: number;
  /** [start, end] of the Hold, where nothing is keyed and content (scrolling) plays. */
  hold?: [number, number];
  /**
   * The Hold's set minimum ("Hold at least"): the part of it that's the same
   * whatever the data, so the editor can draw the timeline from settings alone.
   */
  holdMin?: number;
}

/** Time t, moved out of the clock's Hold to whichever edge of it is nearer. */
export function outsideHold(t: number, clock: Clock) {
  if (!clock.hold) return t;
  const [a, b] = clock.hold;
  return t > a && t < b ? (t - a < b - t ? a : b) : t;
}

/** When key k happens in a timeline `end` ms long. */
export function keyTime(k: Pick<Keyframe, "t" | "fromEnd">, end: number) {
  return k.fromEnd ? end - k.t : k.t;
}

export function hasEndKeys(el: Pick<ElementBase, "keyframes">) {
  return el.keyframes.some((k) => k.fromEnd);
}

/**
 * The element with every key at its time in a timeline `end` ms long, in time
 * order (the element itself when nothing counts from the end). Ids are kept.
 */
export function resolveKeys<E extends Pick<ElementBase, "keyframes">>(el: E, end: number): E {
  if (!hasEndKeys(el)) return el;
  const keyframes = sortedKeyframes(el.keyframes.map(({ fromEnd, ...k }) => ({ ...k, t: keyTime({ t: k.t, fromEnd }, end) })));
  return { ...el, keyframes };
}

/** Just the keys timed from the start: what an element needs before its outro. */
export function withoutEndKeys<E extends Pick<ElementBase, "keyframes">>(el: E): E {
  return hasEndKeys(el) ? { ...el, keyframes: el.keyframes.filter((k) => !k.fromEnd) } : el;
}

/** How far before the end the element's outro starts: its earliest end-anchored key (0 without any). */
export function outroSpanMs(el: Pick<ElementBase, "keyframes">) {
  return Math.max(0, ...el.keyframes.filter((k) => k.fromEnd).map((k) => k.t));
}

/** Puts key k at time `at` (never inside a Hold): counting from the end if that's in the outro, else from the start. */
export function placeKey(k: Keyframe, at: number, clock: Clock) {
  at = outsideHold(at, clock);
  if (clock.outroMs > 0 && at >= clock.end - clock.outroMs) {
    k.t = Math.max(0, clock.end - at);
    k.fromEnd = true;
  } else {
    k.t = Math.max(0, at);
    delete k.fromEnd;
  }
}

/* ---------------- interpolation ---------------- */

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** The state between time-ordered keyframes at time t. */
function interpolate(ks: Keyframe[], t: number): AnimState {
  if (t <= ks[0].t) return ks[0].state;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.state;
  let i = 1;
  while (ks[i].t < t) i++;
  const a = ks[i - 1];
  const b = ks[i];
  const p = ease(b.easing, (t - a.t) / Math.max(1, b.t - a.t));
  return {
    x: lerp(a.state.x, b.state.x, p),
    y: lerp(a.state.y, b.state.y, p),
    w: lerp(a.state.w, b.state.w, p),
    h: lerp(a.state.h, b.state.h, p),
    color: mixColor(a.state.color, b.state.color, Math.min(1, Math.max(0, p))),
    opacity: Math.min(1, Math.max(0, lerp(a.state.opacity, b.state.opacity, p))),
  };
}

/**
 * The element's full state at time t (ms). Positions are left fractional.
 * `end` is its timeline's length, for keys counted from the end; without it the
 * element's keys must already be resolved (see resolveKeys).
 */
export function stateAt(el: Pick<ElementBase, "state" | "keyframes">, t: number, end?: number): AnimState {
  if (end !== undefined) el = resolveKeys(el, end);
  const kfs = el.keyframes;
  if (!kfs.length) return el.state;
  if (!kfs.some((k) => k.channel)) return interpolate(sortedKeyframes(kfs), t);
  // Channel by channel; one without keyframes keeps the element's own value.
  const out: AnimState = { ...el.state };
  for (const c of CHANNELS) {
    const ks = keysFor(el, c);
    if (!ks.length) continue;
    const s = interpolate(ks, t);
    for (const f of CHANNEL_FIELDS[c]) (out as unknown as Record<string, unknown>)[f] = s[f];
  }
  return out;
}

/** Rounds a state onto the pixel grid. */
export function snapState(s: AnimState): AnimState {
  return { ...s, x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h) };
}

const sameIn = (c: Channel, a: AnimState, b: AnimState) => CHANNEL_FIELDS[c].every((f) => a[f] === b[f]);

/**
 * Slide-time spans where keyframes change any of `channels` (merged where they
 * overlap). "step" keys jump rather than move, so they don't count.
 */
export function motionSpans(el: Pick<ElementBase, "keyframes">, channels: Channel[]): [number, number][] {
  const spans: [number, number][] = [];
  for (const c of channels) {
    const ks = keysFor(el, c);
    for (let i = 1; i < ks.length; i++) {
      const a = ks[i - 1];
      const b = ks[i];
      if (b.easing !== "step" && b.t > a.t && !sameIn(c, a.state, b.state)) spans.push([a.t, b.t]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  return merged;
}

/* ---------------- switching modes ---------------- */

/**
 * Together → separate, with no change to the motion: each keyframe becomes one
 * per channel, and a channel that never changes drops its keys (its value
 * moves to the element's own state).
 */
export function splitKeyframes(el: ElementBase) {
  const out: Keyframe[] = [];
  for (const c of CHANNELS) {
    const own = keysFor(el, c);
    if (!own.length) continue;
    if (own.every((k) => sameIn(c, k.state, own[0].state))) {
      for (const f of CHANNEL_FIELDS[c]) (el.state as unknown as Record<string, unknown>)[f] = own[0].state[f];
      continue;
    }
    for (const k of own) out.push({ ...k, id: k.channel ? k.id : uid("kf_"), state: { ...k.state }, channel: c });
  }
  el.keyframes = sortedKeyframes(out);
  el.keyMode = "separate";
}

/** The channels that actually animate (two or more keys). */
function animatedChannels(el: ElementBase) {
  return CHANNELS.map((c) => keysFor(el, c)).filter((ks) => ks.length > 1);
}

/**
 * Whether separate → together keeps the motion exactly: every animated
 * channel has keys at the same times with the same easings.
 */
export function mergeIsExact(raw: ElementBase, end: number) {
  const el = resolveKeys(raw, end);
  const sig = (ks: Keyframe[]) => ks.map((k, i) => `${k.t}:${i ? k.easing : ""}`).join(",");
  const [first, ...rest] = animatedChannels(el).map(sig);
  return rest.every((s) => s === first);
}

/**
 * Separate → together: one keyframe at every time any channel had one, holding
 * the whole state there. Exact when mergeIsExact; otherwise channels with
 * different timing are approximated between the new keys.
 */
export function mergeKeyframes(target: ElementBase, end: number) {
  const el = resolveKeys(target, end);
  const moving = animatedChannels(el);
  const animated = new Set(moving.flatMap((ks) => ks.map((k) => k.id)));
  // Only moving channels place keys: a lone key is a constant, and an extra key
  // in the middle of another channel's move would change its curve.
  const source = moving.length ? el.keyframes.filter((k) => animated.has(k.id)) : el.keyframes.slice(0, 1);
  const times = [...new Set(source.map((k) => k.t))].sort((a, b) => a - b);
  const merged: Keyframe[] = times.map((t) => {
    const here = el.keyframes.filter((k) => k.t === t);
    // Prefer the easing of a channel that really moves into this key.
    const easing = (here.find((k) => animated.has(k.id)) ?? here[0]).easing;
    const k: Keyframe = { id: here[0].id, t, easing, state: { ...stateAt(el, t) } };
    // Still counting from the end if it did.
    if (target.keyframes.find((o) => o.id === k.id)?.fromEnd) Object.assign(k, { t: end - t, fromEnd: true });
    return k;
  });
  target.keyframes = merged;
  target.keyMode = "together";
}
