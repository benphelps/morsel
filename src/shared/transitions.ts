import { ease } from "./easing";
import type { Frame } from "./render";
import type { Direction, Transition, TransitionType } from "./types";
import { HEIGHT, WIDTH } from "./types";

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  cut: "Cut",
  crossfade: "Crossfade",
  fadeBlack: "Fade through black",
  push: "Push",
  cover: "Slide over",
  reveal: "Slide off",
  wipe: "Wipe",
  dissolve: "Pixel dissolve",
  blinds: "Blinds",
};

export const DIRECTIONAL: TransitionType[] = ["push", "cover", "reveal", "wipe", "blinds"];

// Deterministic pixel order for the dissolve, so previews match the device.
const DISSOLVE_RANK: Uint16Array = (() => {
  const n = WIDTH * HEIGHT;
  const order = Array.from({ length: n }, (_, i) => i);
  let seed = 0x2f6b;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const rank = new Uint16Array(n);
  order.forEach((px, r) => (rank[px] = r));
  return rank;
})();

function copyPx(dst: Frame, di: number, src: Frame, si: number) {
  dst[di] = src[si];
  dst[di + 1] = src[si + 1];
  dst[di + 2] = src[si + 2];
  dst[di + 3] = 255;
}

/** Offset (dx, dy) of content moving `amount` pixels toward `dir`. */
function vec(dir: Direction, amount: number): [number, number] {
  switch (dir) {
    case "left":
      return [-amount, 0];
    case "right":
      return [amount, 0];
    case "up":
      return [0, -amount];
    case "down":
      return [0, amount];
  }
}

function sample(src: Frame, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return -1;
  return (y * WIDTH + x) * 4;
}

const BLACK = new Uint8ClampedArray([0, 0, 0, 255]);

/**
 * Composites the outgoing frame `prev` and the incoming frame `next` at
 * progress p (0 = all prev, 1 = all next).
 */
export function composite(tr: Transition, prev: Frame, next: Frame, rawP: number, out: Frame): Frame {
  const p = ease(tr.easing, rawP);
  const dir = tr.direction;
  const span = dir === "left" || dir === "right" ? WIDTH : HEIGHT;
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      switch (tr.type) {
        case "cut":
          copyPx(out, i, rawP > 0 ? next : prev, i);
          break;
        case "crossfade":
          for (let c = 0; c < 3; c++) out[i + c] = prev[i + c] + (next[i + c] - prev[i + c]) * p;
          out[i + 3] = 255;
          break;
        case "fadeBlack": {
          const src = p < 0.5 ? prev : next;
          const k = p < 0.5 ? 1 - p * 2 : p * 2 - 1;
          for (let c = 0; c < 3; c++) out[i + c] = src[i + c] * k;
          out[i + 3] = 255;
          break;
        }
        case "push":
        case "cover":
        case "reveal": {
          const moved = Math.round(span * p);
          const [ndx, ndy] = vec(dir, moved - span); // incoming, starts one span behind
          const [pdx, pdy] = vec(dir, moved);
          const nextSi = sample(next, x - ndx, y - ndy);
          const prevSi = sample(prev, x - pdx, y - pdy);
          if (tr.type === "push") {
            if (nextSi >= 0) copyPx(out, i, next, nextSi);
            else if (prevSi >= 0) copyPx(out, i, prev, prevSi);
            else copyPx(out, i, BLACK, 0);
          } else if (tr.type === "cover") {
            if (nextSi >= 0) copyPx(out, i, next, nextSi);
            else copyPx(out, i, prev, i);
          } else {
            if (prevSi >= 0) copyPx(out, i, prev, prevSi);
            else copyPx(out, i, next, i);
          }
          break;
        }
        case "wipe": {
          const edge = span * p;
          let shown: boolean;
          if (dir === "left") shown = x >= WIDTH - edge;
          else if (dir === "right") shown = x < edge;
          else if (dir === "up") shown = y >= HEIGHT - edge;
          else shown = y < edge;
          copyPx(out, i, shown ? next : prev, i);
          break;
        }
        case "dissolve":
          copyPx(out, i, DISSOLVE_RANK[y * WIDTH + x] < p * WIDTH * HEIGHT ? next : prev, i);
          break;
        case "blinds": {
          const band = 4;
          const horizontal = dir === "up" || dir === "down";
          const pos = horizontal ? y : x;
          const local = dir === "down" || dir === "right" ? pos % band : band - 1 - (pos % band);
          copyPx(out, i, local < p * band ? next : prev, i);
          break;
        }
      }
    }
  return out;
}
