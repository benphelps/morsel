import type { ElementBase } from "../../shared/types";
import type { SlideElement } from "../index";
import type { ElementDef } from "../types";

/**
 * Elements that move, fade and animate as one. Children are positioned
 * relative to the group's top-left and share the slide's clock; the group's
 * opacity multiplies theirs. Resizing the group doesn't scale them: its box
 * is for selecting and, if `clip` is on, for cutting them off at its edges.
 */
export interface GroupElement extends ElementBase {
  type: "group";
  children: SlideElement[];
  clip: boolean;
}

export const groupElement: ElementDef<GroupElement> = {
  type: "group",
  label: "Group",
  group: "container",
  icon: "M2.5 2.5h7v7h-7z M6.5 6.5h7v7h-7z",
  create: () => ({ children: [], clip: false, state: { x: 0, y: 0, w: 64, h: 32, color: "#ffffff", opacity: 1 } }),
  draw(p, el, s, ctx) {
    const inner = (el.clip ? p.box(s) : p).translate(s.x, s.y).fade(s.opacity);
    for (const child of el.children) ctx.draw(inner, child, ctx.t, ctx.scope, ctx.clock);
  },
  // No minDurationMs: children share the group's timeline, so the renderer measures them with its own.
};
