import type { Clock } from "../../shared/animate";
import { resolveTemplate, type Scope } from "../../shared/bindings";
import { holdNeedMs } from "../index";
import { walk } from "../tree";
import type { TimelineTrack } from "../types";
import { phasesOf } from "../../shared/timing";
import { itemScope, MIN_ITEM_MS, playNumber, rotatorItems, rotatorSchedule, rotatorTurns, type RotatorElement } from "./element";

/**
 * A rotator's own timeline row: a bar per item's turn (alternately faded, so
 * they read apart; hover for the item's text), and a marker where each next
 * item comes in. Dragging one sets the item length (fitted: the shortest Hold).
 */
export function rotatorTracks(el: RotatorElement, scope: Scope, clock: Clock): TimelineTrack<RotatorElement>[] {
  const items = rotatorItems(el, scope);
  if (!items.length) return [];
  const durations = rotatorSchedule(el, scope, { holdNeedMs }, items);
  const turns = rotatorTurns(el, durations, clock.end, playNumber(scope));
  // The first text inside names each item.
  const label = [...walk(el.children)].map((h) => h.el).find((c) => c.type === "text");
  // Unlike the item layout, this row is a preview: when each item comes up with the data right now.
  const track: TimelineTrack<RotatorElement> = { id: "items", label: "Items · now", spans: [], markers: [] };
  turns.forEach((turn, n) => {
    const text = label && label.type === "text" ? resolveTemplate(label.text, itemScope(scope, items, turn.i)) : `Item ${turn.i + 1}`;
    track.spans.push({ start: turn.start, end: turn.end - 60, faded: n % 2 === 1, title: `${turn.i + 1}. ${text}` });
    if (n === 0 || n > 30) return;
    track.markers.push({
      id: `item-${n}`,
      t: turn.start,
      shape: "start",
      title: `Item ${turn.i + 1} comes in at ${(turn.start / 1000).toFixed(2)}s. Drag to change ${el.fit ? "the shortest Hold" : "how long each item is"}.`,
      // Spread evenly: this is the nth change-over, so each item takes to / n, In and Out included.
      move: (x, to) => {
        const each = Math.round(to / n / 50) * 50;
        if (!x.fit) return void (x.lengthMs = Math.max(MIN_ITEM_MS, each));
        const { inMs, outMs } = phasesOf(x);
        x.holdMs = Math.max(0, each - inMs - outMs);
      },
    });
  });
  return [track];
}
