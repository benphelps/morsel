// Where times sit along the timeline's tracks (see timeView).
import type { Clock } from "../shared/animate";

/** The part of a Hold drawn squashed: however long the content needs it to be, always this wide (in ms of In/Out time). */
export const HOLD_VIEW_MS = 2000;

/**
 * Where times sit along the tracks. Normally it's just time. In a timeline
 * with a Hold (a rotator item, a fitted slide), it's drawn from settings
 * alone, so it looks the same whatever the data: the In and the Out at real
 * scale, and between them the Hold as one block of a fixed width, since it
 * lasts as long as the content needs. Its start, up to `leadMs` (the latest
 * "Start after" of the text scrolling in it), is at real scale too, so those
 * flags sit where they really are; the rest is squashed into HOLD_VIEW_MS.
 */
export interface TimeView {
  /** The width of the whole track, in view ms. */
  total: number;
  toView(t: number): number;
  fromView(v: number): number;
  /** With a Hold: where the Out starts (view ms); the Hold runs from its real start to here. */
  outStart?: number;
}

export function timeView(clock: Clock, leadMs = 0): TimeView {
  const { end, hold } = clock;
  if (!hold) return { total: end, toView: (t) => t, fromView: (v) => v };
  const [a, b] = hold;
  const len = b - a;
  const lead = Math.max(0, leadMs);
  const width = lead + HOLD_VIEW_MS;
  const outStart = a + width;
  // The Hold's own time d (from its start) along its block: the lead at real scale, the rest squashed.
  // A Hold no longer than the lead is spread over the whole block instead.
  const toBlock = (d: number) => (len <= lead ? (d / Math.max(1, len)) * width : d <= lead ? d : lead + ((d - lead) / (len - lead)) * HOLD_VIEW_MS);
  const fromBlock = (w: number) => (len <= lead ? (w / width) * len : w <= lead ? w : lead + ((w - lead) / HOLD_VIEW_MS) * (len - lead));
  return {
    total: outStart + (end - b),
    outStart,
    toView: (t) => (t <= a ? t : t >= b ? outStart + (t - b) : a + toBlock(t - a)),
    fromView: (v) => (v <= a ? v : v >= outStart ? b + (v - outStart) : a + fromBlock(v - a)),
  };
}
