import { parseColor } from "../../shared/color";
import type { ElementBase } from "../../shared/types";
import type { ElementDef } from "../types";

export interface EllipseElement extends ElementBase {
  type: "ellipse";
  filled: boolean;
}

export const ellipseElement: ElementDef<EllipseElement> = {
  type: "ellipse",
  label: "Ellipse",
  group: "shape",
  icon: "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z",
  create: () => ({ filled: true, state: { x: 4, y: 4, w: 12, h: 12, color: "#ff6fb5", opacity: 1 } }),
  draw(p, el, s) {
    const [r, g, b] = parseColor(s.color);
    const rx = s.w / 2;
    const ry = s.h / 2;
    const inside = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
      const dx = (x + 0.5 - rx) / rx;
      const dy = (y + 0.5 - ry) / ry;
      return dx * dx + dy * dy <= 1.0001;
    };
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        if (!inside(x, y)) continue;
        if (!el.filled && inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) continue;
        p.px(s.x + x, s.y + y, r, g, b, s.opacity);
      }
  },
};
