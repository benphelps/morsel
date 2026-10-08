import type { ReactNode } from "react";
import { phaseMinimumsOf, setPhaseOn } from "../../elements/phases";
import type { SlideElement } from "../../elements";
import { phasesOf, type Timing } from "../../shared/timing";
import { NumberField, Segmented } from "./Fields";

/**
 * How a timeline gets its length, the same controls for a slide and for a
 * rotator's items: a fixed length, or fit to its content (In, Hold, Out).
 */
export function TimingFields({
  noun,
  timing,
  elements,
  length,
  fittedNow,
  onMode,
  edit,
}: {
  /** What's being timed, for the hints: "slide" or "item". */
  noun: string;
  timing: Timing;
  /** What's keyed on the timeline, so the In and Out never cut its keys short. */
  elements: SlideElement[];
  /** The fixed length's field. */
  length: ReactNode;
  /** Fitted: how long it plays with the data right now. */
  fittedNow: ReactNode;
  /** Switches mode; either way it should look the same as now. */
  onMode: (mode: "fixed" | "fit") => void;
  /** Changes the timing; `elements` are the owner's own, inside the change. */
  edit: (fn: (owner: Timing, elements: SlideElement[]) => void, coalesce?: string) => void;
}) {
  const phase = phasesOf(timing);
  // Keys right on an edge move with it, so only the keys inside hold it.
  const mins = phaseMinimumsOf(elements, timing);
  return (
    <>
      <Segmented
        value={timing.fit ? "fit" : "fixed"}
        options={[
          { value: "fixed", label: "Fixed length", title: `Every ${noun} plays for a set time, keyed anywhere` },
          { value: "fit", label: "Fit to content", title: `An In, a Hold as long as the content needs (text scrolling once${noun === "slide" ? ", a rotator's items" : ""}), then an Out` },
        ]}
        onChange={(v) => v !== (timing.fit ? "fit" : "fixed") && onMode(v)}
      />
      {timing.fit ? (
        <>
          <div className="grid2" title={noun === "item" ? "Animate the In and Out inside the rotator: they're the same length for every item, so the animation is too. Only the Hold changes, with the content." : undefined}>
            <NumberField label="In" suffix="ms" step={50} min={mins.inMs} max={10000} value={phase.inMs} onChange={(v) => edit((o, els) => setPhaseOn(o, els, "in", v), "timing-in")} />
            <NumberField label="Out" suffix="ms" step={50} min={mins.outMs} max={10000} value={phase.outMs} onChange={(v) => edit((o, els) => setPhaseOn(o, els, "out", v), "timing-out")} />
          </div>
          <NumberField label="Hold at least" suffix="ms" step={250} min={0} max={60000} value={phase.holdMs} onChange={(v) => edit((o) => (o.holdMs = Math.max(0, Math.round(v))), "timing-hold")} />
          <div className="fit-length" title="It changes with the data, e.g. how long text takes to scroll">
            {fittedNow}
          </div>
        </>
      ) : (
        length
      )}
    </>
  );
}
