import { parseColor } from "../../shared/color";
import type { ElementBase } from "../../shared/types";
import type { ElementDef } from "../types";

export interface RectElement extends ElementBase {
  type: "rect";
  filled: boolean;
  radius: number;
}

export const rectElement: ElementDef<RectElement> = {
  type: "rect",
  label: "Rectangle",
  group: "shape",
  icon: "M2.5 4.5h11v7h-11z",
  create: () => ({ filled: true, radius: 0, state: { x: 4, y: 4, w: 20, h: 10, color: "#3aa0ff", opacity: 1 } }),
  draw(p, el, s) {
    const [r, g, b] = parseColor(s.color);
    const rad = Math.max(0, Math.min(el.radius, Math.floor(Math.min(s.w, s.h) / 2)));
    const inside = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
      const inCornerX = x < rad || x >= s.w - rad;
      const inCornerY = y < rad || y >= s.h - rad;
      if (!rad || !inCornerX || !inCornerY) return true;
      const cx = x < rad ? rad : s.w - rad;
      const cy = y < rad ? rad : s.h - rad;
      return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rad - 0.3;
    };
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        if (!inside(x, y)) continue;
        if (!el.filled && inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) continue;
        p.px(s.x + x, s.y + y, r, g, b, s.opacity);
      }
  },
};
