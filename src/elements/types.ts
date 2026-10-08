// The contract every element type implements. Two halves, so the server never
// loads React: an ElementDef (fields, defaults, drawing) shared by the editor
// and the server, and an ElementEditor (inspector UI) used only by the editor.
import type { ComponentType } from "react";
import type { Scope } from "../shared/bindings";
import type { Painter } from "../shared/painter";
import type { Clock } from "../shared/animate";
import type { AnimState, ElementBase, Slide } from "../shared/types";

/** The toolbar's groups, in order: things to show, shapes, data and effects, and containers. */
export type ElementGroup = "content" | "shape" | "data" | "container";

/** The fields every element has; `create()` supplies everything else. */
type Common = "id" | "type" | "name" | "keyframes";

export interface ElementDef<E extends ElementBase & { type: string }> {
  type: E["type"];
  /** Toolbar label, and the name a new element starts with. */
  label: string;
  /** Which part of the toolbar it's in (see ELEMENT_GROUPS). */
  group: ElementGroup;
  /**
   * Its icon for the toolbar, layer list and inspector: SVG path data on a
   * 16×16 grid, stroked in the text colour (plain data, so the server can load it too).
   */
  icon: string;
  /**
   * The starting fields and box for a new element. `scope` is the data in
   * the editor right now, for picking sensible bindings (a sparkline's series).
   */
  create(scope?: Scope): Omit<E, Common>;
  /**
   * Draws the element. `s` is its state at time `t`, already animated and
   * snapped to whole pixels; the renderer skips hidden, invisible and
   * `showIf`-failing elements before calling this.
   */
  draw(p: Painter, el: E, s: AnimState, ctx: DrawContext): void;
  /**
   * Children run on a clock of their own (a rotator's items), rather than
   * sharing this element's timeline as a group's do.
   */
  ownClock?: boolean;
  /** String fields that may hold {{bindings}}, so renaming a source can rewrite them. */
  bindable?: readonly (keyof E & string)[];
  /**
   * How long a slide needs to run for this element to finish (e.g. text that
   * scrolls once, or a rotator's pass through its items), in ms. Containers
   * measure their children through `measure`. Keys counted from the end are
   * left out; the renderer adds the outro after.
   */
  minDurationMs?(el: E, scope: Scope, measure: Measure): number;
}

/** Any element, as the renderer passes it to a container (the full union lives in ./index). */
export type SlideElementLike = ElementBase & { type: string };

/** How containers measure their children (passed in, so element types never import the registry). */
export interface Measure {
  /** How long these elements need on a timeline of their own (intros, scrolling, then outros). */
  minDurationMs(elements: SlideElementLike[], scope: Scope): number;
  /**
   * How long these elements need to hold still, as they are at time `at`, for
   * their content to finish (text scrolling once, say): their keyframes aside.
   */
  holdNeedMs(elements: SlideElementLike[], scope: Scope, at: number): number;
}

export interface DrawContext extends Measure {
  /** Milliseconds from the start of the slide (or, inside a rotator, of the item). */
  t: number;
  /** That timeline: its length (for keys counted from its end) and, in a rotator item, its Hold. */
  clock: Clock;
  scope: Scope;
  /**
   * Draws one element as the renderer would (hidden, showIf, keyframes and
   * all). Containers use it for their children, with a painter translated to
   * their own box, and their own time and scope.
   */
  draw(p: Painter, el: SlideElementLike, t: number, scope: Scope, clock: Clock): void;
}

/* ---------------- editor half ---------------- */

export interface PanelProps<E> {
  el: E;
  slide: Slide;
  /** The timeline it's on: the slide's, or the item's being edited inside a rotator. */
  clock: Clock;
  /** Changes this element. Edits sharing a `coalesce` key within a second form one undo step. */
  edit(fn: (el: E) => void, coalesce?: string): void;
}

export interface AddButtonProps<E> {
  /** Adds a new element of this type with these fields on top of its defaults. */
  add(extra: Partial<E>): void;
  disabled: boolean;
}

/**
 * An extra timeline row an element type adds under the element (in either
 * keying mode), for timing of its own, e.g. when text starts and stops scrolling.
 */
export interface TimelineTrack<E> {
  /** Also names its colour: CSS class `ch-<id>`. */
  id: string;
  label: string;
  /** Bars for when it's active, in slide ms (a null end runs to the slide's end); faded ones are overruns. */
  spans: { start: number; end: number | null; faded?: boolean; title?: string }[];
  /** Draggable markers; `move` updates the element for a new slide time. */
  markers: { id: string; t: number; shape: "start" | "end"; title: string; move(el: E, t: number): void }[];
}

export interface ElementEditor<E> {
  /** The type's own section in the inspector, below position, colour and opacity. */
  Panel?: ComponentType<PanelProps<E>>;
  /** Replaces the plain toolbar button, e.g. images pick a file first. */
  AddButton?: ComponentType<AddButtonProps<E>>;
  /** Timeline rows of its own, shown when the element's row is expanded. */
  tracks?(el: E, scope: Scope, clock: Clock): TimelineTrack<E>[];
}
