import { Note, NumberField } from "../../web/components/Fields";
import { TimingFields } from "../../web/components/TimingFields";
import { fitSlideToContent, fitToContent, fixLength } from "../../web/model";
import { useStore } from "../../web/store";
import type { Slide } from "../../shared/types";
import { itemLength, MIN_ITEM_MS, type RotatorElement } from "./element";

// A rotator's items' timing: set inside the rotator, beside the item timeline
// it shapes.

export const secs = (ms: number) => `${Number((ms / 1000).toFixed(1))}s`;

/** The shortest and longest of some lengths, e.g. "4.2–6s", or one length if they're all the same. */
export function spread(ms: number[]) {
  const [lo, hi] = [Math.min(...ms), Math.max(...ms)];
  return secs(lo) === secs(hi) ? secs(lo) : `${secs(lo).slice(0, -1)}–${secs(hi)}`;
}

/** The items' timing in a few words, e.g. "5s each" or "Fit · 5.9–7.3s". */
export function timingSummary(el: RotatorElement, durations: number[]) {
  if (!el.fit) return `${secs(itemLength(el))} each${el.outroMs ? ` · outro ${secs(el.outroMs)}` : ""}`;
  return `Fit · ${durations.length ? spread(durations) : `In ${secs(el.inMs ?? 0)} · Out ${secs(el.outMs ?? 0)}`}`;
}

/** Items longer than the timeline the rotator is on (`parentEnd`) never get to their end: says so, and offers to fit the slide. */
export function TooLongNote({ el, slide, durations, parentEnd }: { el: RotatorElement; slide: Slide; durations: number[]; parentEnd: number }) {
  const longest = durations.length ? Math.max(...durations) : 0;
  if (longest <= parentEnd + 1) return null;
  const fitSlide = () =>
    useStore.getState().update((p) => {
      const s = p.slides.find((x) => x.id === slide.id) ?? p.systemSlides?.find((x) => x.id === slide.id);
      if (s && !s.fit) fitSlideToContent(s);
    });
  return (
    <Note tone="warn">
      <span>
        {el.fit ? `Items run up to ${secs(longest)} right now` : `Each item is ${secs(longest)}`}, but the slide is {secs(parentEnd)}, so their end{(el.fit ? el.outMs : el.outroMs) ? ` (the ${el.fit ? "Out" : "outro"})` : ""} is cut off.{" "}
        {!slide.fit && (
          <button className="link" onClick={fitSlide}>
            Fit the slide to them
          </button>
        )}
      </span>
    </Note>
  );
}

/**
 * How long each item is: a fixed length, or fit to its content (In, Hold, Out).
 * `durations` are the items' lengths right now; `parentEnd` the length of the
 * timeline the rotator is on.
 */
export function ItemTiming({ el, slide, durations, parentEnd, edit }: { el: RotatorElement; slide: Slide; durations: number[]; parentEnd: number; edit: (fn: (x: RotatorElement) => void, coalesce?: string) => void }) {
  return (
    <>
      <TimingFields
        noun="item"
        timing={el}
        elements={el.children}
        onMode={(v) =>
          edit((x) => {
            // Either way the items look the same as now.
            if (v === "fit") return fitToContent(x, x.children, itemLength(x));
            // Fixed: as long as the longest item runs now, so nothing's cut short, but not past the slide's end, so the outro plays.
            const longest = durations.length ? Math.max(...durations) : itemLength(x);
            x.lengthMs = Math.max(MIN_ITEM_MS, Math.round(Math.min(longest, parentEnd) / 50) * 50);
            fixLength(x);
          })
        }
        edit={(fn, key) => edit((x) => fn(x, x.children), key && `rot-${key}-${el.id}`)}
        length={<NumberField label="Length" suffix="ms" step={250} min={MIN_ITEM_MS} max={120000} value={itemLength(el)} onChange={(v) => edit((x) => (x.lengthMs = Math.max(MIN_ITEM_MS, Math.round(v))), `rot-length-${el.id}`)} />}
        fittedNow={
          durations.length ? (
            <>
              Items run <b className="mono">{spread(durations)}</b> right now
            </>
          ) : (
            "No items right now"
          )
        }
      />
      <TooLongNote el={el} slide={slide} durations={durations} parentEnd={parentEnd} />
    </>
  );
}
