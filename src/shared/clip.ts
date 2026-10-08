import type { Scope } from "./bindings";
import { newFrame, renderSlide, settleSlide, type Frame } from "./render";
import { composite } from "./transitions";
import type { Slide } from "./types";

export interface Clip {
  frames: Frame[];
  /** Milliseconds each frame stays up. */
  delays: number[];
  durationMs: number;
}

export function frameMsFor(fps: number) {
  return Math.round(1000 / fps);
}

export function hasTransition(slide: Slide, prev: Frame | null | undefined): prev is Frame {
  return !!prev && slide.transition.type !== "cut" && slide.transition.durationMs > 0;
}

/** One frame of a slide, including its entry transition over `prev`. */
export function renderFrame(slide: Slide, t: number, scope: Scope, prev?: Frame | null, out: Frame = newFrame(), scratch?: Frame): Frame {
  if (hasTransition(slide, prev) && t < slide.transition.durationMs) {
    const incoming = renderSlide(slide, t, scope, scratch ?? newFrame());
    return composite(slide.transition, prev, incoming, t / slide.transition.durationMs, out);
  }
  return renderSlide(slide, t, scope, out);
}

function same(a: Frame, b: Frame) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Renders a whole slide into frames. Consecutive identical frames are merged
 * into one longer frame, which keeps static slides tiny on the wire.
 */
export function renderClip(played: Slide, opts: { fps: number; scopeAt: (t: number) => Scope; prev?: Frame | null }): Clip {
  // Fitted to its content, the slide's length is settled once, with the data as it starts.
  const slide = settleSlide(played, opts.scopeAt(0));
  const frameMs = frameMsFor(opts.fps);
  const durationMs = Math.max(1, slide.durationSec) * 1000;
  const count = Math.max(1, Math.round(durationMs / frameMs));
  const frames: Frame[] = [];
  const delays: number[] = [];
  const scratch = newFrame();
  for (let i = 0; i < count; i++) {
    const t = i * frameMs;
    const f = renderFrame(slide, t, opts.scopeAt(t), opts.prev, newFrame(), scratch);
    const d = i === count - 1 ? durationMs - t : frameMs;
    if (frames.length && same(frames[frames.length - 1], f)) delays[delays.length - 1] += d;
    else {
      frames.push(f);
      delays.push(d);
    }
  }
  return { frames, delays, durationMs };
}
