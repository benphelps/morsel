import { resolveTemplate, type Scope } from "../../shared/bindings";
import { parseColor } from "../../shared/color";
import { getIcon, MOON_SHADOW } from "../../shared/icons";
import { iconForScale } from "../../shared/icons2x";
import type { ElementBase } from "../../shared/types";
import type { ElementDef } from "../types";

export interface IconElement extends ElementBase {
  type: "icon";
  /** Icon name, or a binding such as {{weather.icon}}. */
  icon: string;
  scale: number;
  /** At 2× or 4×, double the 1× pixels instead of using the detailed 2× art. */
  blocky?: boolean;
  /** Draw every lit pixel in state.color instead of the icon's own palette. */
  tint: boolean;
}

/** The bitmap and pixel scale this icon draws with right now (the moon icons show the phase at the scope's time). */
export function iconFor(el: IconElement, scope: Scope) {
  return iconForScale(resolveTemplate(el.icon, scope), el.scale, el.blocky, typeof scope.$now === "number" ? scope.$now : Date.now());
}

/** The box an unbound icon fills exactly; null when it's bound (its size varies). */
export function iconBoxSize(el: IconElement) {
  if (el.icon.includes("{{")) return null;
  const found = iconForScale(el.icon, el.scale, el.blocky);
  return found ? { w: found.icon.w * found.k, h: found.icon.h * found.k } : null;
}

export const iconElement: ElementDef<IconElement> = {
  type: "icon",
  label: "Icon",
  group: "content",
  icon: "M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z M8 1.5v1.5 M8 13v1.5 M1.5 8H3 M13 8h1.5 M3.4 3.4l1.1 1.1 M11.5 11.5l1.1 1.1 M3.4 12.6l1.1-1.1 M11.5 4.5l1.1-1.1",
  create() {
    const icon = getIcon("sun")!;
    return { icon: "sun", scale: 1, tint: false, state: { x: 2, y: 2, w: icon.w, h: icon.h, color: "#ffffff", opacity: 1 } };
  },
  draw(p, el, s, { scope }) {
    const found = iconFor(el, scope);
    if (!found) return;
    const { icon, k } = found;
    const tint = parseColor(s.color);
    // Centre inside the box so bound icons of different sizes stay put.
    const ox = s.x + Math.floor((s.w - icon.w * k) / 2);
    const oy = s.y + Math.floor((s.h - icon.h * k) / 2);
    for (let y = 0; y < icon.h; y++)
      for (let x = 0; x < icon.w; x++) {
        const c = icon.px[y * icon.w + x];
        if (!c) continue;
        const [r, g, b] = el.tint ? tint : parseColor(c);
        // Tinted, the moon's dark side stays dim, so its phase still shows.
        const a = el.tint && c === MOON_SHADOW ? s.opacity * 0.3 : s.opacity;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) p.px(ox + x * k + dx, oy + y * k + dy, r, g, b, a);
      }
  },
  bindable: ["icon"],
};
