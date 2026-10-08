import { drawElement, holdNeedMs } from "../elements";
import type { Clock } from "./animate";
import type { Scope } from "./bindings";
import { parseColor } from "./color";
import { Painter, PANEL_VIEW, type Frame, type View } from "./painter";
import { fittedMs, phasesOf, timingClock } from "./timing";
import type { Slide } from "./types";

export { PANEL_VIEW, type Frame, type View } from "./painter";

export function newFrame(view: View = PANEL_VIEW): Frame {
  return new Uint8ClampedArray(view.w * view.h * 4);
}

/**
 * Renders a slide at time t (ms from slide start), ignoring its transition.
 * `view` picks the region of slide space to draw; the editor uses a larger one
 * to show elements parked outside the panel. How each element draws is up to
 * its type in src/elements/.
 */
export function renderSlide(slide: Slide, t: number, scope: Scope, out?: Frame, view: View = PANEL_VIEW): Frame {
  out ??= newFrame(view);
  const [r, g, b] = parseColor(slide.background);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  }
  const p = new Painter(out, view);
  // Fitted, the clock carries the Hold too: text there scrolls in it, as the timeline shows.
  const clock = slideClock(slide, slide.durationSec * 1000);
  for (const el of slide.elements) drawElement(p, el, t, scope, clock);
  return out;
}

/** The longest a slide fitted to its content plays, and the shortest (s). */
export const FIT_MAX_SEC = 120;
export const FIT_MIN_SEC = 2;

/** The slide's timeline when it plays `end` ms (see timingClock). */
export function slideClock(slide: Slide, end: number): Clock {
  return timingClock(slide, end);
}

/**
 * How long a fitted slide plays right now, in whole seconds: its In, a Hold as
 * long as the content needs (a rotator's pass, text scrolling once) or its
 * shortest Hold, and its Out.
 */
export function fittedSec(slide: Slide, scope: Scope): number {
  const need = holdNeedMs(slide.elements, { ...scope, ...slide.scope }, phasesOf(slide).inMs);
  return Math.min(FIT_MAX_SEC, Math.max(FIT_MIN_SEC, Math.ceil(fittedMs(slide, need) / 1000)));
}

/**
 * The slide as it plays: fitted to its content, a copy whose durationSec is
 * what the content needs with this data (see Slide.fit); otherwise the slide itself.
 */
export function settleSlide(slide: Slide, scope: Scope): Slide {
  if (!slide.fit) return slide;
  const sec = fittedSec(slide, scope);
  return sec === slide.durationSec ? slide : { ...slide, durationSec: sec };
}

export function blackFrame(): Frame {
  const f = newFrame();
  for (let i = 3; i < f.length; i += 4) f[i] = 255;
  return f;
}
