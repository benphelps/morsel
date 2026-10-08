// Pure editing helpers that operate on immer drafts of the project.
import { CHANNEL_FIELDS, CHANNELS, isSeparate, keysChannel, keysFor, keyTime, outsideHold, placeKey, resolveKeys, snapState, stateAt, type Clock } from "../shared/animate";
import { onClock } from "../elements";
import { childrenOf, findInTree, walk } from "../elements/tree";
import { frameMsFor } from "../shared/clip";
import { createElement } from "../shared/defaults";
import { uid } from "../shared/id";
import type { Timing } from "../shared/timing";
import type { AnimState, Channel, EasingName, Keyframe, Project, Slide, SlideElement } from "../shared/types";
import { HEIGHT, WIDTH } from "../shared/types";

export const DEFAULT_KEY_EASING: EasingName = "easeInOutQuad";

export function findSlide(p: Project, id: string | null) {
  return p.slides.find((s) => s.id === id) ?? p.systemSlides?.find((s) => s.id === id) ?? null;
}

/** An element anywhere on the slide, inside containers too (ids are unique across the tree). */
export function findElement(slide: Slide | null, id: string | null): SlideElement | null {
  return slide ? (findInTree(slide.elements, id)?.el ?? null) : null;
}

/** The element on a slide of the project (e.g. an immer draft), wherever it is in the tree. */
export function findEl(p: Project, slideId: string | null, id: string | null): SlideElement | null {
  return findElement(findSlide(p, slideId), id);
}

/** The list that holds an element: the slide's, or a container's children. */
export function listOf(p: Project, slideId: string | null, id: string | null): SlideElement[] | null {
  const slide = findSlide(p, slideId);
  return slide ? (findInTree(slide.elements, id)?.list ?? null) : null;
}

/** The list being edited at a level: the slide's, or the entered container's children. */
export function contextList(p: Project, slideId: string | null, inside: string[]): SlideElement[] | null {
  let list = findSlide(p, slideId)?.elements ?? null;
  for (const id of inside) {
    const c = list?.find((e) => e.id === id);
    list = c ? childrenOf(c) : null;
  }
  return list;
}

export function snapTime(t: number, fps: number) {
  const f = frameMsFor(fps);
  return Math.round(t / f) * f;
}

/** The keyframe within half a frame of t (on `channel`, if given), on a timeline `end` ms long. */
export function keyframeNear(el: SlideElement, t: number, fps: number, end: number, channel?: Channel) {
  const tol = frameMsFor(fps) / 2;
  return el.keyframes.find((k) => Math.abs(keyTime(k, end) - t) <= tol && (!channel || k.channel === channel)) ?? null;
}

/** Sorts keys by when they happen on this timeline (the order they're saved in doesn't matter, but reads nicer). */
function sortKeys(el: SlideElement, end: number) {
  el.keyframes.sort((a, b) => keyTime(a, end) - keyTime(b, end));
}

/** Places a key at time t on whole frames: counted from the end, it's the distance to the end that's whole frames. */
function placeOnFrame(k: Keyframe, t: number, clock: Clock, fps: number) {
  placeKey(k, t, clock);
  k.t = snapTime(k.t, fps);
}

function newKey(el: SlideElement, t: number, fps: number, clock: Clock, channel?: Channel, patch: Partial<AnimState> = {}): Keyframe {
  const kf: Keyframe = { id: uid("kf_"), t: 0, easing: DEFAULT_KEY_EASING, state: { ...snapState(stateAt(el, t, clock.end)), ...patch } };
  placeOnFrame(kf, t, clock, fps);
  if (channel) kf.channel = channel;
  el.keyframes.push(kf);
  return kf;
}

/** Moves a key to time t on its timeline, counting from the end if that's past the outro line. */
export function moveKey(el: SlideElement, kfId: string, t: number, clock: Clock, fps: number) {
  const k = el.keyframes.find((k) => k.id === kfId);
  if (!k) return;
  placeOnFrame(k, t, clock, fps);
  sortKeys(el, clock.end);
}

/**
 * Switches a timeline (a slide's, or a rotator's items') to fit its content,
 * looking just as it does at its current length `end`: the longest stretch with
 * no keys becomes the Hold (and its shortest length), keys before it the In,
 * and keys after it the Out, counting from the end.
 */
export function fitToContent(owner: Timing, elements: SlideElement[], end: number) {
  const els = [...onClock(elements)];
  const at = (k: Keyframe) => Math.max(0, Math.min(end, keyTime(k, end)));
  const times = [...new Set([0, end, ...els.flatMap((el) => el.keyframes.map(at))])].sort((x, y) => x - y);
  let [a, b] = [0, end];
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > b - a || i === 1) [a, b] = [times[i - 1], times[i]];
  const clock: Clock = { end, outroMs: end - b, hold: [a, b] };
  for (const el of els) for (const k of el.keyframes) placeKey(k, at(k), clock);
  owner.fit = true;
  owner.inMs = a;
  owner.outMs = end - b;
  owner.holdMs = b - a;
  delete owner.outroMs;
}

/** Back to a fixed length (set by the caller): the Out's keys keep counting from the end, as its outro. */
export function fixLength(owner: Timing) {
  if (owner.outMs) owner.outroMs = owner.outMs;
  for (const k of ["fit", "inMs", "outMs", "holdMs"] as const) delete owner[k];
}

export function fitSlideToContent(slide: Slide) {
  fitToContent(slide, slide.elements, slide.durationSec * 1000);
}

/** A slide back to a set length (whole seconds). */
export function fixSlideLength(slide: Slide, sec: number) {
  slide.durationSec = sec;
  fixLength(slide);
}

/**
 * Moves a fixed-length timeline's outro line to `ms` before its end (`end` ms
 * long as it plays). Keys that end up after it start counting from the end,
 * and keys before it from the start, all staying where they are now.
 */
export function setOutroOn(owner: Timing, elements: SlideElement[], ms: number, end: number) {
  const clock = { end, outroMs: Math.max(0, Math.min(end, Math.round(ms))) };
  for (const el of onClock(elements)) for (const k of el.keyframes) placeKey(k, keyTime(k, end), clock);
  if (clock.outroMs) owner.outroMs = clock.outroMs;
  else delete owner.outroMs;
}

/**
 * Applies a change to an element at the playhead. Without keyframes it edits
 * the element directly; with keyframes it updates the keyframe under the
 * playhead, or creates one capturing the element's whole state there. Keyed
 * separately, the same happens per channel: moving it keys Position only.
 * Returns the id of the keyframe touched, if any.
 */
export function editState(el: SlideElement, patch: Partial<AnimState>, t: number, fps: number, clock: Clock): string | null {
  if (clock.hold && t > clock.hold[0] && t < clock.hold[1]) return editRestingPose(el, patch, clock);
  if (!isSeparate(el)) {
    if (!el.keyframes.length) {
      Object.assign(el.state, patch);
      return null;
    }
    const hit = keyframeNear(el, t, fps, clock.end);
    if (hit) {
      Object.assign(hit.state, patch);
      return hit.id;
    }
    const kf = newKey(el, t, fps, clock, undefined, patch);
    sortKeys(el, clock.end);
    return kf.id;
  }
  let touched: string | null = null;
  for (const c of CHANNELS) {
    const part = Object.fromEntries(CHANNEL_FIELDS[c].filter((f) => f in patch).map((f) => [f, patch[f]])) as Partial<AnimState>;
    if (!Object.keys(part).length) continue;
    if (!keysFor(el, c).length) {
      Object.assign(el.state, part); // not animated: a plain edit
      continue;
    }
    const hit = keyframeNear(el, t, fps, clock.end, c);
    if (hit) Object.assign(hit.state, part);
    touched = (hit ?? newKey(el, t, fps, clock, c, part)).id;
  }
  sortKeys(el, clock.end);
  return touched;
}

/**
 * An edit during a Hold (a fitted slide's or a rotator item's), where nothing
 * is keyed: it changes the pose the element rests in there, which is the last
 * key of the In and the first of the Out (per channel, keyed separately).
 * Without keys, a plain edit.
 */
function editRestingPose(el: SlideElement, patch: Partial<AnimState>, clock: Clock): string | null {
  const [a, b] = clock.hold!;
  const timed = resolveKeys(el, clock.end);
  let touched: string | null = null;
  for (const c of isSeparate(el) ? CHANNELS : [undefined]) {
    const fields = c ? CHANNEL_FIELDS[c] : (Object.keys(patch) as (keyof AnimState)[]);
    const part = Object.fromEntries(fields.filter((f) => f in patch).map((f) => [f, patch[f]])) as Partial<AnimState>;
    if (!Object.keys(part).length) continue;
    const ks = c ? keysFor(timed, c) : timed.keyframes;
    if (!ks.length) {
      Object.assign(el.state, part);
      continue;
    }
    const lastIn = [...ks].reverse().find((k) => k.t <= a);
    const firstOut = ks.find((k) => k.t >= b);
    for (const hit of [lastIn, firstOut]) {
      const k = hit && el.keyframes.find((x) => x.id === hit.id);
      if (!k) continue;
      Object.assign(k.state, part);
      touched ??= k.id;
    }
  }
  return touched;
}

/** Sets a size-ish field everywhere (base + all keyframes), for non-animated tweaks like fitting text. */
export function setEverywhere(el: SlideElement, patch: Partial<AnimState>) {
  Object.assign(el.state, patch);
  for (const k of el.keyframes) Object.assign(k.state, patch);
}

/**
 * Keys the element as it is at t. Keyed separately: `channel` only, or every
 * channel when none is given. Returns the keyframe to select.
 */
export function addKeyframe(el: SlideElement, t: number, fps: number, clock: Clock, channel?: Channel): string {
  t = outsideHold(t, clock); // nothing's keyed in a Hold: the nearer edge of it
  let id = "";
  const channels = !isSeparate(el) ? [undefined] : channel ? [channel] : CHANNELS;
  for (const c of channels) id ||= (keyframeNear(el, t, fps, clock.end, c) ?? newKey(el, t, fps, clock, c)).id;
  sortKeys(el, clock.end);
  return id;
}

export function removeKeyframe(el: SlideElement, kfId: string) {
  const kf = el.keyframes.find((k) => k.id === kfId);
  el.keyframes = el.keyframes.filter((k) => k.id !== kfId);
  if (!kf) return;
  // A channel left without keys stays where this keyframe had it.
  for (const c of CHANNELS)
    if (keysChannel(kf, c) && !keysFor(el, c).length) for (const f of CHANNEL_FIELDS[c]) (el.state as unknown as Record<string, unknown>)[f] = kf.state[f];
}

export function duplicateElement(el: SlideElement): SlideElement {
  const copy: SlideElement = JSON.parse(JSON.stringify(el));
  // Fresh ids all the way down: ids are unique across the whole tree.
  for (const { el: e } of walk([copy])) {
    e.id = uid("el_");
    e.keyframes.forEach((k) => (k.id = uid("kf_")));
  }
  copy.name = `${el.name} copy`;
  return copy;
}

/* ---------------- containers ---------------- */

/** Moves an element (its state and every keyframe) by (dx, dy). */
export function shiftElement(el: SlideElement, dx: number, dy: number) {
  for (const s of [el.state, ...el.keyframes.map((k) => k.state)]) {
    s.x += dx;
    s.y += dy;
  }
}

/** The box around elements as they are at time t (on a timeline `end` ms long), in their level's coordinates. */
export function boundsOf(els: SlideElement[], t: number, end: number) {
  const ss = els.map((el) => snapState(stateAt(el, t, end)));
  const x = Math.min(...ss.map((s) => s.x));
  const y = Math.min(...ss.map((s) => s.y));
  return { x, y, w: Math.max(...ss.map((s) => s.x + s.w)) - x, h: Math.max(...ss.map((s) => s.y + s.h)) - y };
}

/**
 * Wraps elements of one list in a new group the size of their box at time t,
 * in place: they look the same, keep their order, and now move with the
 * group, which takes the topmost one's place. Returns the group.
 */
export function groupElements(list: SlideElement[], ids: string[], t: number, end: number): SlideElement | null {
  const picked = list.filter((e) => ids.includes(e.id));
  if (!picked.length) return null;
  const box = boundsOf(picked, t, end);
  const name = picked.length === 1 ? `${picked[0].name} group` : "Group";
  const group = createElement("group", { name, state: { x: box.x, y: box.y, w: Math.max(1, box.w), h: Math.max(1, box.h), color: "#ffffff", opacity: 1 } });
  for (const el of picked) shiftElement(el, -box.x, -box.y);
  if (group.type === "group") group.children = picked;
  const top = list.indexOf(picked[picked.length - 1]) - (picked.length - 1);
  for (const el of picked) list.splice(list.indexOf(el), 1);
  list.splice(top, 0, group);
  return group;
}

export type Alignment = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/**
 * Lines elements up with each other at the playhead: their left edges, centres
 * or right edges with the left-, middle- or right-most of the box around them
 * (or the same for top to bottom). Keyed like any other edit at the playhead.
 */
export function alignElements(els: SlideElement[], how: Alignment, t: number, fps: number, clock: Clock) {
  const box = boundsOf(els, t, clock.end);
  for (const el of els) {
    const s = snapState(stateAt(el, t, clock.end));
    const patch: Partial<AnimState> =
      how === "left"
        ? { x: box.x }
        : how === "hcenter"
          ? { x: box.x + Math.round((box.w - s.w) / 2) }
          : how === "right"
            ? { x: box.x + box.w - s.w }
            : how === "top"
              ? { y: box.y }
              : how === "vcenter"
                ? { y: box.y + Math.round((box.h - s.h) / 2) }
                : { y: box.y + box.h - s.h };
    editState(el, patch, t, fps, clock);
  }
}

/**
 * Takes a group's children out into the list that held it, where they appear
 * now (at time t). Animation on the group itself is lost; theirs is kept.
 */
export function ungroup(list: SlideElement[], id: string, t: number, end: number): SlideElement[] {
  const i = list.findIndex((e) => e.id === id);
  const group = list[i];
  if (i < 0 || group?.type !== "group") return [];
  const at = snapState(stateAt(group, t, end));
  for (const c of group.children) shiftElement(c, at.x, at.y);
  list.splice(i, 1, ...group.children);
  return group.children;
}

/** Moves an element into a sibling container, keeping where it appears (at time t of a timeline `end` ms long). */
export function moveInto(list: SlideElement[], id: string, containerId: string, t: number, end: number) {
  const el = list.find((e) => e.id === id);
  const target = list.find((e) => e.id === containerId);
  const kids = target && childrenOf(target);
  if (!el || !kids || el === target) return;
  const at = snapState(stateAt(target, t, end));
  list.splice(list.indexOf(el), 1);
  shiftElement(el, -at.x, -at.y);
  kids.push(el);
}

/**
 * Moves an element out of its container into the container's own list, just
 * above it, keeping where it appears (t and `end` are on the container's timeline).
 */
export function moveOut(parentList: SlideElement[], containerId: string, id: string, t: number, end: number) {
  const container = parentList.find((e) => e.id === containerId);
  const kids = container && childrenOf(container);
  const el = kids?.find((e) => e.id === id);
  if (!container || !kids || !el) return;
  const at = snapState(stateAt(container, t, end));
  kids.splice(kids.indexOf(el), 1);
  shiftElement(el, at.x, at.y);
  parentList.splice(parentList.indexOf(container) + 1, 0, el);
}

export function duplicateSlide(s: Slide): Slide {
  const copy: Slide = JSON.parse(JSON.stringify(s));
  copy.id = uid("sl_");
  copy.name = `${s.name} copy`;
  copy.elements = copy.elements.map((e) => ({ ...duplicateElement(e), name: e.name }));
  return copy;
}

/* ---------------- animation presets ---------------- */

export type PresetId = "enter-left" | "enter-right" | "enter-top" | "enter-bottom" | "fade-in" | "pop-in" | "exit-left" | "exit-right" | "exit-top" | "exit-bottom" | "fade-out" | "blink";

export const PRESETS: { id: PresetId; label: string; group: "Enter" | "Exit" | "Loop" }[] = [
  { id: "enter-left", label: "Slide in from left", group: "Enter" },
  { id: "enter-right", label: "Slide in from right", group: "Enter" },
  { id: "enter-top", label: "Drop in from top", group: "Enter" },
  { id: "enter-bottom", label: "Rise from bottom", group: "Enter" },
  { id: "fade-in", label: "Fade in", group: "Enter" },
  { id: "pop-in", label: "Bounce in", group: "Enter" },
  { id: "exit-left", label: "Slide out left", group: "Exit" },
  { id: "exit-right", label: "Slide out right", group: "Exit" },
  { id: "exit-top", label: "Fly out top", group: "Exit" },
  { id: "exit-bottom", label: "Drop out bottom", group: "Exit" },
  { id: "fade-out", label: "Fade out", group: "Exit" },
  { id: "blink", label: "Blink", group: "Loop" },
];

const offscreen = (s: AnimState, side: "left" | "right" | "top" | "bottom"): AnimState => {
  switch (side) {
    case "left":
      return { ...s, x: -s.w };
    case "right":
      return { ...s, x: WIDTH };
    case "top":
      return { ...s, y: -s.h };
    case "bottom":
      return { ...s, y: HEIGHT };
  }
};

/** How long a preset's move takes; exits start this long before the end. */
export const PRESET_MS = 600;

export function isExitPreset(preset: PresetId) {
  return preset.startsWith("exit") || preset === "fade-out";
}

/**
 * Adds keyframes for a preset. Enter presets start at the playhead, exit
 * presets end at the timeline's end (and, past the outro line, count back from
 * it); existing keyframes in that span are replaced.
 */
export function applyPreset(el: SlideElement, preset: PresetId, clock: Clock, playhead: number, fps: number) {
  const { end } = clock;
  const dur = PRESET_MS;
  // Keyed separately, a preset keys just what it animates and leaves other channels alone.
  const channel: Channel | undefined = isSeparate(el) ? (preset.includes("fade") || preset === "blink" ? "opacity" : "position") : undefined;
  const mine = (k: Keyframe) => !channel || k.channel === channel;
  const at = (k: Keyframe) => keyTime(k, end);
  const put = (t: number, state: AnimState, easing: EasingName) => {
    const k: Keyframe = { id: uid("kf_"), t, easing, state, ...(channel && { channel }) };
    placeOnFrame(k, Math.max(0, Math.min(end, t)), clock, fps);
    const when = at(k);
    el.keyframes = el.keyframes.filter((x) => !mine(x) || Math.abs(at(x) - when) > 1);
    el.keyframes.push(k);
  };
  const clearSpan = (a: number, b: number) => (el.keyframes = el.keyframes.filter((k) => !mine(k) || at(k) < a - 1 || at(k) > b + 1));
  const stateThen = (t: number) => snapState(stateAt(el, t, end));

  if (preset.startsWith("enter") || preset === "fade-in" || preset === "pop-in") {
    const t0 = snapTime(playhead, fps);
    const t1 = Math.min(end, t0 + dur);
    const rest = stateThen(t1);
    clearSpan(t0, t1);
    let from: AnimState;
    let easing: EasingName = "easeOutCubic";
    if (preset === "fade-in") from = { ...rest, opacity: 0 };
    else if (preset === "pop-in") {
      from = { ...rest, y: -rest.h };
      easing = "easeOutBounce";
    } else from = offscreen(rest, preset.split("-")[1] as any);
    put(t0, from, "linear");
    put(t1, rest, easing);
  } else if (isExitPreset(preset)) {
    const t1 = end;
    const t0 = Math.max(0, t1 - dur);
    const rest = stateThen(t0);
    clearSpan(t0, t1);
    const to = preset === "fade-out" ? { ...rest, opacity: 0 } : offscreen(rest, preset.split("-")[1] as any);
    put(t0, rest, "linear");
    put(t1, to, "easeInCubic");
  } else if (preset === "blink") {
    const rest = stateThen(playhead);
    el.keyframes = el.keyframes.filter((k) => !mine(k));
    for (let t = 0; t <= end; t += 500) put(t, { ...rest, opacity: (t / 500) % 2 === 0 ? 1 : 0 }, "step");
  }
  sortKeys(el, end);
}

/* ---------------- resizing ---------------- */

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/**
 * The box after dragging `handle` by (dx, dy) pixels, Photoshop style:
 * `keepAspect` preserves width:height (edge handles grow the other side
 * symmetrically), `fromCenter` resizes around the box's centre.
 */
export function resizeBox(
  s: { x: number; y: number; w: number; h: number },
  handle: Handle,
  dx: number,
  dy: number,
  keepAspect: boolean,
  fromCenter: boolean,
): { x: number; y: number; w: number; h: number } {
  const k = fromCenter ? 2 : 1;
  const east = handle.includes("e");
  const west = handle.includes("w");
  const south = handle.includes("s");
  const north = handle.includes("n");
  let w = s.w;
  let h = s.h;
  if (east) w = s.w + dx * k;
  if (west) w = s.w - dx * k;
  if (south) h = s.h + dy * k;
  if (north) h = s.h - dy * k;
  w = Math.max(1, w);
  h = Math.max(1, h);

  const horizontal = east || west;
  const vertical = north || south;
  if (keepAspect && s.w > 0 && s.h > 0) {
    const ratio = s.w / s.h;
    // Corners follow whichever axis moved further, relative to its size.
    const byWidth = horizontal && (!vertical || Math.abs(w / s.w - 1) >= Math.abs(h / s.h - 1));
    if (byWidth) h = Math.max(1, Math.round(w / ratio));
    else w = Math.max(1, Math.round(h * ratio));
  }

  let x = s.x;
  let y = s.y;
  if (fromCenter) {
    x = s.x + Math.round((s.w - w) / 2);
    y = s.y + Math.round((s.h - h) / 2);
  } else {
    if (west) x = s.x + s.w - w;
    else if (!horizontal) x = s.x + Math.round((s.w - w) / 2); // n/s edge with aspect lock
    if (north) y = s.y + s.h - h;
    else if (!vertical) y = s.y + Math.round((s.h - h) / 2); // e/w edge with aspect lock
  }
  return { x, y, w, h };
}
