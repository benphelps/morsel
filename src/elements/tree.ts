// Containers (groups, rotators) hold elements of their own in `children`.
// These helpers treat a slide's elements as the tree that makes.
import type { SlideElementLike } from "./types";

/** A container's children, or null for an element that can't hold any. */
export function childrenOf<E extends SlideElementLike>(el: E): E[] | null {
  const c = (el as unknown as { children?: unknown }).children;
  return Array.isArray(c) ? (c as E[]) : null;
}

export function isContainer(el: SlideElementLike) {
  return childrenOf(el) !== null;
}

/** Every element in the tree, depth first, each with the list that holds it. */
export function* walk<E extends SlideElementLike>(list: E[], parent: E | null = null): Generator<{ el: E; list: E[]; parent: E | null }> {
  for (const el of list) {
    yield { el, list, parent };
    const kids = childrenOf(el);
    if (kids) yield* walk(kids, el);
  }
}

/** An element anywhere in the tree, with the list it's in and its container (null at the top). */
export function findInTree<E extends SlideElementLike>(list: E[], id: string | null): { el: E; list: E[]; parent: E | null } | null {
  if (!id) return null;
  for (const hit of walk(list)) if (hit.el.id === id) return hit;
  return null;
}
