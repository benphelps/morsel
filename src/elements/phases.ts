// In / Hold / Out, for any timeline that has them: a rotator's items, or a
// slide fitted to its content. Keys in the In count from the start, keys in
// the Out from the end; nothing is keyed in the Hold.
import type { SlideElementLike } from "./types";

/** Something with an In and an Out: a rotator, or a fitted slide. */
export interface Phased {
  inMs?: number;
  outMs?: number;
}

/** The keyframed elements on a timeline: into groups, but not into a rotator, which runs on its own clock. */
function* keyed(elements: SlideElementLike[]): Generator<SlideElementLike> {
  for (const c of elements) {
    yield c;
    const kids = (c as { children?: SlideElementLike[] }).children;
    if (Array.isArray(kids) && c.type !== "rotator") yield* keyed(kids);
  }
}

/** Within half a millisecond: the same moment. */
const at = (t: number, edge: number) => Math.abs(t - edge) < 0.5;

type Key = SlideElementLike["keyframes"][number];

/**
 * Whether a key changes nothing by being where it is: the same as the key
 * before it on its channel, and as the one after (if any). Such a key on an
 * edge is just where the element rests, so it can move with the edge.
 */
function idle(keys: Key[], k: Key) {
  // In time order: keys from the start, then keys from the end (counting down).
  const line = keys.filter((o) => o.channel === k.channel).sort((x, y) => (x.fromEnd ? 1 : 0) - (y.fromEnd ? 1 : 0) || (x.fromEnd ? y.t - x.t : x.t - y.t));
  const i = line.indexOf(k);
  const same = (o?: Key) => !o || JSON.stringify(o.state) === JSON.stringify(k.state);
  return i > 0 && same(line[i - 1]) && same(line[i + 1]);
}

/** The keys on an In's or Out's edge (`edge` ms from the start or the end) that just mark where an element rests. */
function* resting(elements: SlideElementLike[], phase: "in" | "out", edge: number): Generator<[SlideElementLike, Key]> {
  if (edge <= 0) return;
  for (const c of keyed(elements)) for (const k of c.keyframes) if (!!k.fromEnd === (phase === "out") && at(k.t, edge) && idle(c.keyframes, k)) yield [c, k];
}

/**
 * The shortest In and Out that still hold every key inside: the latest key
 * from the start, and the earliest from the end, among the elements on the
 * timeline. With `owner`, keys resting on its In's or Out's edge, which change
 * nothing there, don't count: they move with the edge (see setPhaseOn).
 */
export function phaseMinimumsOf(elements: SlideElementLike[], owner?: Phased) {
  const skip = new Set<Key>(owner ? [...resting(elements, "in", owner.inMs ?? 0), ...resting(elements, "out", owner.outMs ?? 0)].map(([, k]) => k) : []);
  let inMs = 0;
  let outMs = 0;
  for (const c of keyed(elements))
    for (const k of c.keyframes) {
      if (skip.has(k)) continue;
      if (k.fromEnd) outMs = Math.max(outMs, k.t);
      else inMs = Math.max(inMs, k.t);
    }
  return { inMs, outMs };
}

/**
 * Sets the In or Out length, never so short that keys would end up in the
 * Hold. Keys resting on the edge (where an element just stays as it was) move
 * with it, so they never hold it in place.
 */
export function setPhaseOn(owner: Phased, elements: SlideElementLike[], phase: "in" | "out", ms: number) {
  const min = phaseMinimumsOf(elements, owner);
  const v = Math.round(Math.max(phase === "in" ? min.inMs : min.outMs, ms));
  for (const [c, k] of [...resting(elements, phase, phase === "in" ? (owner.inMs ?? 0) : (owner.outMs ?? 0))]) {
    k.t = v;
    // Landing on a key just like it (the same moment, the same pose): one is enough.
    const twin = c.keyframes.find((o) => o !== k && !!o.fromEnd === !!k.fromEnd && at(o.t, v) && o.channel === k.channel && JSON.stringify(o.state) === JSON.stringify(k.state));
    if (twin) c.keyframes.splice(c.keyframes.indexOf(k), 1);
  }
  if (phase === "in") owner.inMs = v;
  else owner.outMs = v;
}
