// How a timeline gets its length, the same for a slide and for each item of a
// rotator: a fixed length (keys anywhere, with an optional outro line), or fit
// to its content (an In, a Hold as long as the content needs, and an Out).
import type { Clock } from "./animate";

export interface Timing {
  /**
   * Fit to content: an In (keyed from the start), a Hold as long as the
   * content needs but at least holdMs (nothing keyed; text scrolls here), and
   * an Out (keyed from the end). Otherwise the length is fixed.
   */
  fit?: boolean;
  inMs?: number;
  outMs?: number;
  holdMs?: number;
  /**
   * Fixed length: the outro line, in ms before the end. Keys after it count
   * back from the end, so exits stay put if the length changes. 0 or missing: none.
   */
  outroMs?: number;
}

/** A fitted timeline's In and Out, and its shortest Hold (ms). */
export function phasesOf(t: Pick<Timing, "inMs" | "outMs" | "holdMs">) {
  return { inMs: Math.max(0, t.inMs ?? 0), outMs: Math.max(0, t.outMs ?? 0), holdMs: Math.max(0, t.holdMs ?? 0) };
}

/** A fitted timeline's length when its content needs `needMs` of Hold. */
export function fittedMs(t: Timing, needMs: number) {
  const { inMs, outMs, holdMs } = phasesOf(t);
  return inMs + Math.max(holdMs, needMs) + outMs;
}

/**
 * The timeline when it plays `end` ms: fitted, its Out counts from the end
 * and the Hold sits between In and Out; otherwise its outro line, if any.
 */
export function timingClock(t: Timing, end: number): Clock {
  if (!t.fit) return { end, outroMs: Math.max(0, Math.min(end, t.outroMs ?? 0)) };
  const { inMs, outMs, holdMs } = phasesOf(t);
  const a = Math.min(inMs, end);
  return { end, outroMs: outMs, hold: [a, Math.max(a, end - outMs)], holdMin: holdMs };
}
