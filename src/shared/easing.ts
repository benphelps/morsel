import type { EasingName } from "./types";

const bounceOut = (t: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

export const EASINGS: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  step: (t) => (t < 1 ? 0 : 1),
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeInBack: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  easeOutBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  easeOutBounce: bounceOut,
  easeOutElastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
};

export const EASING_LABELS: Record<EasingName, string> = {
  linear: "Linear",
  step: "Hold (jump at end)",
  easeInQuad: "Ease in",
  easeOutQuad: "Ease out",
  easeInOutQuad: "Ease in-out",
  easeInCubic: "Ease in (strong)",
  easeOutCubic: "Ease out (strong)",
  easeInOutCubic: "Ease in-out (strong)",
  easeInBack: "Back in",
  easeOutBack: "Back out (overshoot)",
  easeOutBounce: "Bounce",
  easeOutElastic: "Elastic",
};

export function ease(name: EasingName, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return (EASINGS[name] ?? EASINGS.linear)(clamped);
}
