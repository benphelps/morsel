import { unwrap } from "../../shared/bindings";
import { BindingField } from "../../web/components/BindingField";
import { Icon } from "../../web/components/Icon";
import { Note, NoteRow, NumberField, Section, Segmented } from "../../web/components/Fields";
import { fitSlideToContent } from "../../web/model";
import { scopeAt, useStore } from "../../web/store";
import { holdNeedMs } from "../index";
import type { PanelProps } from "../types";
import { rotatorItems, rotatorSchedule, rotatorTurns, type RotatorElement } from "./element";
import { secs, timingSummary, TooLongNote } from "./ItemTiming";

export function RotatorPanel({ el, slide, clock, edit }: PanelProps<RotatorElement>) {
  const scope = scopeAt(Date.now());
  const current = unwrap(el.list);
  const items = rotatorItems(el, scope);
  const durations = rotatorSchedule(el, scope, { holdNeedMs }, items);
  const cycleMs = durations.reduce((a, b) => a + b, 0);
  // Each play of the slide starts from the first item, so only what fits in it ever shows.
  const fits = new Set(rotatorTurns(el, durations, clock.end).map((t) => t.i)).size;
  const loops = el.loop !== false;
  // Showing a few items each time: how many, and how many showings it takes to get through them all.
  const perPlay = Math.floor(el.perPlay ?? 0);
  const cycling = perPlay > 0 && perPlay < items.length;
  const showings = cycling ? Math.ceil(items.length / perPlay) : 1;
  const fitSlide = () => useStore.getState().update((p) => {
    const s = p.slides.find((x) => x.id === slide.id) ?? p.systemSlides?.find((x) => x.id === slide.id);
    if (s && !s.fit) fitSlideToContent(s);
  });
  const n = el.children.length;

  const showSummary = perPlay > 0 ? `${perPlay} per showing` : loops ? "Every item, looping" : "Every item, once";

  return (
    <>
      <Section
        id="rotator-items"
        title="Items"
        summary={`${current || "No list"} · ${items.length}`}
        actions={
          <button className="fold-action" title={`Edit items: inside the rotator, the item's ${n} element${n === 1 ? "" : "s"} and how long each item is`} aria-label="Edit items" onClick={() => useStore.getState().enter(el.id)}>
            <Icon name="enter" size={14} />
          </button>
        }
      >
        <div className="field">
          <span className="field-label">List</span>
          <BindingField kind="list" value={el.list} placeholder="Pick a list…" scope={scope} onChange={(v) => edit((x) => (x.list = v))} />
        </div>
        {items.length ? (
          <Note tone={!cycling && fits < items.length ? "warn" : "info"}>
            {cycling ? (
              <>
                <NoteRow label={`${items.length} items`} value={`${perPlay} per showing`} />
                <span>
                  All {items.length} take {showings} showings, then it starts again.
                </span>
              </>
            ) : (
              <NoteRow label={`${items.length} item${items.length === 1 ? "" : "s"}`} value={loops ? `${secs(cycleMs)} a cycle` : `${secs(cycleMs)}, then stays`} />
            )}
            {!cycling && fits < items.length && (
              <span>
                Each play starts from the first item, so this {secs(clock.end)} slide shows {fits} of them.{" "}
                {!slide.fit && (
                  <button className="link" onClick={fitSlide}>
                    Fit the slide to them
                  </button>
                )}
              </span>
            )}
          </Note>
        ) : (
          <Note tone="warn">This list is empty right now{el.emptyText ? ", so it shows the empty text." : "."}</Note>
        )}
        {/* Each item's timing is set inside, beside the item timeline it shapes. */}
        <Note tone="muted">
          <NoteRow label="Each item" value={timingSummary(el, durations)} />
        </Note>
        <TooLongNote el={el} slide={slide} durations={durations} parentEnd={clock.end} />
        <div className="field-stack">
          <NumberField label="Max items" suffix={el.maxItems ? "" : "all"} min={0} max={50} value={el.maxItems} onChange={(v) => edit((x) => (x.maxItems = Math.round(v)), `rot-max-${el.id}`)} />
        </div>
        <label className="field">
          <span className="field-label">When the list is empty</span>
          <input value={el.emptyText} placeholder="Nothing (leave blank to show nothing)" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => edit((x) => (x.emptyText = e.target.value), `rot-empty-${el.id}`)} />
        </label>
      </Section>

      <Section id="rotator-playback" title="Playback" summary={`${showSummary} · ${el.transition}`}>
        <label className="field">
          <span className="field-label">Each time the slide shows</span>
          <Segmented
            value={perPlay > 0 ? "some" : "all"}
            options={[
              { value: "all", label: "Every item", title: "Go through the items each time the slide plays" },
              { value: "some", label: "The next few", title: "Show only the next item (or few) each time the slide plays, carrying on from last time" },
            ]}
            onChange={(v) =>
              edit((x) => {
                if (v === "all") delete x.perPlay;
                else x.perPlay = 1;
              })
            }
          />
        </label>
        {perPlay > 0 ? (
          <>
            <NumberField label="Items each time" min={1} max={20} value={perPlay} onChange={(v) => edit((x) => (x.perPlay = Math.max(1, Math.round(v))), `rot-perplay-${el.id}`)} />
            <Note tone="muted">Each showing carries on from where the last one left off, round to the first after the last.</Note>
          </>
        ) : (
          <label className="check" title="Off: show each item once, then stay on the last">
            <input type="checkbox" checked={loops} onChange={(e) => edit((x) => (x.loop = e.target.checked))} /> Start over after the last item
          </label>
        )}
        <label className="field">
          <span className="field-label">Change-over</span>
          <Segmented
            value={el.transition}
            options={[
              { value: "push-up", label: "Push up" },
              { value: "push-left", label: "Push left" },
              { value: "fade", label: "Fade" },
              { value: "cut", label: "Cut" },
            ]}
            onChange={(v) => edit((x) => (x.transition = v))}
          />
        </label>
        {el.transition !== "cut" && (
          <NumberField label="Change over" suffix="ms" step={50} min={50} max={2000} value={el.transitionMs} onChange={(v) => edit((x) => (x.transitionMs = v), `rot-tr-${el.id}`)} />
        )}
      </Section>
    </>
  );
}
