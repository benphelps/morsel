import { parseColor } from "../../shared/color";
import type { ElementBase } from "../../shared/types";
import type { ElementDef } from "../types";

export interface LineElement extends ElementBase {
  type: "line";
  /** Line runs from (x, y) to (x + w - 1, y + h - 1) unless flipped. */
  flip: boolean;
}

export const lineElement: ElementDef<LineElement> = {
  type: "line",
  label: "Line",
  group: "shape",
  icon: "M3 13L13 3",
  create: () => ({ flip: false, state: { x: 2, y: 16, w: 60, h: 1, color: "#ffc21a", opacity: 1 } }),
  draw(p, el, s) {
    // Bresenham, corner to corner across the box.
    const [r, g, b] = parseColor(s.color);
    const w = Math.max(1, s.w);
    const h = Math.max(1, s.h);
    let x0 = s.x;
    let y0 = el.flip ? s.y + h - 1 : s.y;
    const x1 = s.x + w - 1;
    const y1 = el.flip ? s.y : s.y + h - 1;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      p.px(x0, y0, r, g, b, s.opacity);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  },
};
