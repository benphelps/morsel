// Where editing is happening: the slide itself, or inside a container (a
// group or rotator) that was entered by double-clicking it. Everything that
// shows or edits "the current elements" works through this, so the canvas,
// layers, timeline and inspector behave the same at every level.
import { holdNeedMs, type SlideElement } from "../elements";
import { firstTurn, itemClock, itemLength, itemScope, nominalItemMs, rotatorItems, rotatorSchedule } from "../elements/rotator/element";
import { childrenOf } from "../elements/tree";
import { snapState, stateAt, type Clock } from "../shared/animate";
import { fittedSec, slideClock } from "../shared/render";
import type { Scope } from "../shared/bindings";
import type { Slide } from "../shared/types";
import { HEIGHT, WIDTH } from "../shared/types";

export interface Level {
  container: SlideElement;
  kind: "group" | "rotator";
  /** The length of the timeline the container itself is on. */
  end: number;
  /** Rotators: the item being edited, and how many there are. */
  item?: number;
  items?: number;
}

export interface EditContext {
  slide: Slide;
  /** The containers entered, outermost first. */
  levels: Level[];
  container: SlideElement | null;
  /** The elements being edited. */
  elements: SlideElement[];
  /** This level's timeline, in ms: the slide's, or one item's inside a rotator. */
  duration: number;
  /** This level's outro, in ms before its end (0 for none): its outro line, or fitted, its Out. */
  outroMs: number;
  /** Whose timing this is (its length, outro line, or In, Hold and Out): the rotator whose item timeline it is, or null for the slide. */
  outroOwner: string | null;
  /** The timeline's length, outro and (fitted) Hold, for placing keys. */
  clock: Clock;
  /** The slide's length as it plays: fitted to its content, what that needs now. */
  slideMs: number;
  /** The space children are laid out in: the panel, or the container's box. */
  size: { w: number; h: number };
  /** This level's time (the playhead) as slide time. */
  toSlideTime(local: number): number;
  /** Where this level's (0, 0) is on the panel at a moment of its time. */
  origin(local: number): { x: number; y: number };
  /** Bindings available here: {{item.*}}, {{index}} and {{count}} inside a rotator. */
  scope(base: Scope): Scope;
}

export function editContext(slide: Slide, inside: string[], previewItem: number, baseScope: Scope, playHint = 0): EditContext {
  let elements = slide.elements;
  let toSlide = (t: number) => t;
  let origin = (_t: number) => ({ x: 0, y: 0 });
  let extend = (sc: Scope) => sc;
  // Which showing of the slide is previewed: inside a rotator that shows a few items each time, the one with the item being edited.
  let play = playHint;
  const slideMs = (slide.fit ? fittedSec(slide, { ...baseScope, $play: play }) : slide.durationSec) * 1000;
  let duration = slideMs;
  // The slide's own timeline: its outro line, or fitted, its In, Hold and Out (a rotator's items are timed the same way).
  const top = slideClock(slide, slideMs);
  let outroMs = top.outroMs;
  let outroOwner: string | null = null;
  let hold = top.hold;
  let holdMin = top.holdMin;
  let size = { w: WIDTH, h: HEIGHT };
  const levels: Level[] = [];
  for (const id of inside) {
    const c = elements.find((e) => e.id === id);
    const kids = c && childrenOf(c);
    if (!c || !kids) break;
    const [parentToSlide, parentOrigin, parentExtend, parentEnd] = [toSlide, origin, extend, duration];
    // `local` is the child level's time; `parentTime` maps it to the level holding the container.
    let parentTime = (t: number) => t;
    if (c.type === "rotator") {
      const sc = parentExtend(baseScope);
      const items = rotatorItems(c, sc);
      const durations = rotatorSchedule(c, sc, { holdNeedMs }, items);
      const i = Math.max(0, Math.min(items.length - 1, previewItem));
      const k = Math.floor(c.perPlay ?? 0);
      if (k > 0 && k < items.length) play = Math.floor(i / k);
      const thisPlay = play;
      // The item's first turn (the last one's runs on to the end of the slide without looping).
      const turn = items.length ? firstTurn(c, durations, i, parentEnd, thisPlay) : { start: 0, end: nominalItemMs(c) };
      parentTime = (t) => turn.start + t;
      // A fixed-length item is edited at its length, even the last, which may hold on past it.
      const ic = itemClock(c, c.fit ? turn : { start: turn.start, end: turn.start + itemLength(c) });
      duration = ic.end;
      outroMs = ic.outroMs;
      hold = ic.hold;
      holdMin = ic.holdMin;
      outroOwner = c.id;
      extend = (b) => (items.length ? { ...itemScope(parentExtend(b), items, i), $play: thisPlay } : parentExtend(b));
      levels.push({ container: c, kind: "rotator", end: parentEnd, item: i, items: items.length });
    } else {
      levels.push({ container: c, kind: "group", end: parentEnd });
    }
    const pt = parentTime;
    toSlide = (t) => parentToSlide(pt(t));
    origin = (t) => {
      const o = parentOrigin(pt(t));
      const s = snapState(stateAt(c, pt(t), parentEnd));
      return { x: o.x + s.x, y: o.y + s.y };
    };
    const box = snapState(stateAt(c, pt(0), parentEnd));
    size = { w: box.w, h: box.h };
    elements = kids;
  }
  // A fitted slide's length depends on the showing: measure again for the one previewed.
  if (slide.fit && play !== playHint) return editContext(slide, inside, previewItem, baseScope, play);
  return {
    slide,
    levels,
    container: levels.at(-1)?.container ?? null,
    elements,
    duration,
    outroMs,
    outroOwner,
    clock: { end: duration, outroMs, ...(hold && { hold, holdMin }) },
    slideMs,
    size,
    toSlideTime: toSlide,
    origin,
    scope: extend,
  };
}
