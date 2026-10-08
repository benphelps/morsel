// Element types. Each lives in its own folder:
//   element.ts  its fields, defaults and how it draws (shared by the editor and the server)
//   Panel.tsx   its section of the inspector (editor only)
// To add one: write both, list the ElementDef below and the Panel in ./editors.ts.
// The compiler then points at anything else that needs to know about it.
import { outroSpanMs, resolveKeys, snapState, stateAt, withoutEndKeys, type Clock } from "../shared/animate";
import { conditionHolds, resolveNumber, type Scope } from "../shared/bindings";
import type { AnimState, ColorFrom } from "../shared/types";
import type { Painter } from "../shared/painter";
import { effectElement } from "./effect/element";
import { ellipseElement } from "./ellipse/element";
import { groupElement } from "./group/element";
import { iconElement } from "./icon/element";
import { imageElement } from "./image/element";
import { lineElement } from "./line/element";
import { rectElement } from "./rect/element";
import { rotatorElement } from "./rotator/element";
import { sparklineElement } from "./sparkline/element";
import { textElement } from "./text/element";
import { childrenOf } from "./tree";
import type { ElementDef, ElementGroup, Measure, SlideElementLike } from "./types";

/** In toolbar order, group by group (see ElementGroup). */
const DEFS = [textElement, iconElement, imageElement, rectElement, ellipseElement, lineElement, sparklineElement, effectElement, rotatorElement, groupElement] as const;

/** The toolbar's groups, in order, with names for screen readers. */
export const ELEMENT_GROUPS: { id: ElementGroup; label: string }[] = [
  { id: "content", label: "Text and images" },
  { id: "shape", label: "Shapes" },
  { id: "data", label: "Data and effects" },
  { id: "container", label: "Containers" },
];

type ElementOf<D> = D extends ElementDef<infer E> ? E : never;

export type SlideElement = ElementOf<(typeof DEFS)[number]>;
export type ElementType = SlideElement["type"];
export type ElementOfType<T extends ElementType> = Extract<SlideElement, { type: T }>;

export type { EffectElement } from "./effect/element";
export type { EllipseElement } from "./ellipse/element";
export type { GroupElement } from "./group/element";
export type { IconElement } from "./icon/element";
export type { ImageElement } from "./image/element";
export type { LineElement } from "./line/element";
export type { RectElement } from "./rect/element";
export type { RotatorElement } from "./rotator/element";
export type { SparklineElement } from "./sparkline/element";
export type { TextElement } from "./text/element";

export const ELEMENT_TYPES: ElementType[] = DEFS.map((d) => d.type);

const BY_TYPE = new Map<string, ElementDef<any>>(DEFS.map((d) => [d.type, d]));

/** The definition for a type; undefined for a type this build doesn't know (e.g. a project from a newer version). */
export function elementDef<T extends ElementType>(type: T): ElementDef<ElementOfType<T>> {
  return BY_TYPE.get(type)!;
}

/** Draws one element at time t of a timeline, if it's visible then. */
export function drawElement(p: Painter, el: SlideElementLike, t: number, scope: Scope, clock: Clock) {
  if (el.hidden || !conditionHolds(el.showIf, scope)) return;
  const def = BY_TYPE.get(el.type);
  if (!def) return;
  // Types draw with every key at its time, so they never deal with keys counted from the end.
  const timed = resolveKeys(el, clock.end);
  const s = withDataColor(snapState(stateAt(timed, t)), el.colorFrom, scope);
  if (s.opacity <= 0) return;
  def.draw(p, timed, s, { t, clock, scope, draw: drawElement, ...MEASURE });
}

/** The colour a number picks (see ColorFrom), or null while the value isn't a number. */
export function dataColor(c: ColorFrom | undefined, scope: Scope): string | null {
  if (!c?.value.trim()) return null;
  const v = resolveNumber(c.value, scope);
  if (v == null) return null;
  const at = c.threshold ?? 0;
  return v > at ? c.above : v < at ? c.below : (c.equal ?? c.above);
}

function withDataColor(s: AnimState, c: ColorFrom | undefined, scope: Scope): AnimState {
  const color = dataColor(c, scope);
  return color ? { ...s, color } : s;
}

/** Whether a container's children share its timeline (a group's do; a rotator's run on item time). */
export function sharesClock(el: SlideElementLike) {
  return !BY_TYPE.get(el.type)?.ownClock;
}

/** The elements on one timeline: these, and the children of groups among them, but not of rotators. */
export function* onClock<E extends SlideElementLike>(list: E[]): Generator<E> {
  for (const el of list) {
    yield el;
    const kids = childrenOf(el);
    if (kids && sharesClock(el)) yield* onClock(kids);
  }
}

/** Rewrites every binding-bearing field of an element (its type's own, plus showIf), and its children's. */
export function rewriteBindings(el: SlideElementLike, fn: (template: string) => string) {
  if (el.showIf) el.showIf = fn(el.showIf);
  if (el.colorFrom) el.colorFrom.value = fn(el.colorFrom.value);
  const rec = el as unknown as Record<string, unknown>;
  for (const key of BY_TYPE.get(el.type)?.bindable ?? []) {
    const v = rec[key];
    if (typeof v === "string") rec[key] = fn(v);
  }
  for (const child of childrenOf(el) ?? []) rewriteBindings(child, fn);
}

/**
 * How long a timeline with these elements needs to run so they all finish, in
 * ms: everything timed from the start (text scrolling once, intros), then the
 * longest outro counted back from the end.
 */
export function minDurationMs(elements: SlideElementLike[], scope: Scope): number {
  let before = 0;
  let outro = 0;
  for (const el of onClock(elements)) {
    const need = BY_TYPE.get(el.type)?.minDurationMs?.(withoutEndKeys(el), scope, MEASURE);
    if (need) before = Math.max(before, need);
    const span = outroSpanMs(el);
    if (!span) continue;
    outro = Math.max(outro, span);
    // Its intro plays out before its outro starts.
    before = Math.max(before, ...el.keyframes.filter((k) => !k.fromEnd).map((k) => k.t));
  }
  return before + outro;
}

/**
 * How long elements need to hold still, as they are at time `at`, for their
 * content to finish (text scrolling once from the start of the hold, a rotator
 * inside going through its items): their keyframes don't come into it.
 */
export function holdNeedMs(elements: SlideElementLike[], scope: Scope, at: number): number {
  let need = 0;
  for (const el of onClock(elements)) {
    const def = BY_TYPE.get(el.type);
    if (!def?.minDurationMs) continue;
    const still = { ...el, keyframes: [], state: stateAt(withoutEndKeys(el), at) };
    need = Math.max(need, def.minDurationMs(still, scope, MEASURE));
  }
  return need;
}

const MEASURE: Measure = { minDurationMs, holdNeedMs };
