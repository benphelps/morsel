import { useEffect, useState } from "react";
import { CHANNEL_LABELS, keysFor, keyTime, snapState, stateAt } from "../../shared/animate";
import { EASING_LABELS } from "../../shared/easing";
import { uid } from "../../shared/id";
import { DIRECTIONAL, TRANSITION_LABELS } from "../../shared/transitions";
import { conditionHolds } from "../../shared/bindings";
import { fittedSec } from "../../shared/render";
import { NOTIFY_FIELDS, SYSTEM_KINDS } from "../../shared/templates";
import { elementDef, holdNeedMs } from "../../elements";
import { rotatorItems, rotatorSchedule, type RotatorElement } from "../../elements/rotator/element";
import { ItemTiming, timingSummary } from "../../elements/rotator/ItemTiming";
import type { Level } from "../context";
import { elementEditor } from "../../elements/editors";
import type { AnimState, Channel, ColorFrom, Direction, EasingName, Slide, SlideElement, TransitionType } from "../../shared/types";
import { api } from "../api";
import { isContainer } from "../../elements/tree";
import { alignElements, editState, findEl, findElement, findSlide, fitSlideToContent, fixSlideLength, listOf, moveInto, moveKey, moveOut, removeKeyframe, type Alignment } from "../model";
import { liveScopeAt, scopeAt, useEditContext, useSelection, useStore } from "../store";
import { ColorField, InfoPopover, Note, NumberField, Section, Segmented } from "./Fields";
import { BindingField } from "./BindingField";
import { ElementGlyph } from "./ElementGlyph";
import { ItemDataDrawer } from "./ItemData";
import { OverlayScroll } from "./OverlayScroll";
import { TimingFields } from "./TimingFields";
import { ColourControl } from "./ColourFrom";
import { Icon, PathIcon } from "./Icon";

const EASINGS = Object.keys(EASING_LABELS) as EasingName[];

export function Inspector() {
  const slide = useStore((s) => (s.project ? findSlide(s.project, s.slideId) : null));
  const elementId = useStore((s) => s.elementId);
  const selection = useSelection();
  const el = findElement(slide, elementId);
  // With nothing selected: the timeline in view's settings, the slide's or (inside a rotator) its items'.
  const rotator = [...(useEditContext()?.levels ?? [])].reverse().find((l) => l.kind === "rotator");
  if (!slide) return <aside className="inspector" />;
  return (
    <aside className="inspector">
      <OverlayScroll className="insp-scroll">
        {selection.length > 1 ? (
          <MultiInspector slide={slide} ids={selection} />
        ) : el ? (
          <ElementInspector slide={slide} el={el} />
        ) : rotator ? (
          <ItemInspector slide={slide} level={rotator} />
        ) : (
          <SlideInspector slide={slide} />
        )}
      </OverlayScroll>
      <ItemDataDrawer />
    </aside>
  );
}

/* ---------------- several elements ---------------- */

const ALIGNMENTS: { id: Alignment; title: string; d: string }[] = [
  { id: "left", title: "Align left edges", d: "M2.5 2v12 M5 5h8 M5 10.5h5" },
  { id: "hcenter", title: "Align centres, across", d: "M8 2v12 M4 5h8 M5.5 10.5h5" },
  { id: "right", title: "Align right edges", d: "M13.5 2v12 M3 5h8 M6 10.5h5" },
  { id: "top", title: "Align top edges", d: "M2 2.5h12 M5 5v8 M10.5 5v5" },
  { id: "vcenter", title: "Align middles, up and down", d: "M2 8h12 M5 4v8 M10.5 5.5v5" },
  { id: "bottom", title: "Align bottom edges", d: "M2 13.5h12 M5 3v8 M10.5 6v5" },
];

/**
 * More than one element selected: lining them up, and what they share. Values
 * shown are the leading element's (the last one picked); changes go to them all.
 */
function MultiInspector({ slide, ids }: { slide: Slide; ids: string[] }) {
  const playhead = useStore((s) => s.playhead);
  const fps = useStore((s) => s.project!.fps);
  const elementId = useStore((s) => s.elementId);
  const { update } = useStore.getState();
  const ctx = useEditContext();
  const clock = ctx?.clock ?? { end: slide.durationSec * 1000, outroMs: slide.outroMs ?? 0 };
  const els = ids.map((id) => findElement(slide, id)).filter((x): x is SlideElement => !!x);
  const lead = els.find((x) => x.id === elementId) ?? els[els.length - 1];
  if (!lead) return null;
  const now = snapState(stateAt(lead, playhead, clock.end));
  const key = ids.join(",");
  const withEach = (fn: (x: SlideElement) => void, coalesce?: string) =>
    update((p) => {
      for (const id of ids) {
        const x = findEl(p, slide.id, id);
        if (x) fn(x);
      }
    }, coalesce);
  const setAll = (patch: Partial<AnimState>, field: string) => withEach((x) => editState(x, patch, playhead, fps, clock), `multi-${field}-${key}`);
  const sameType = els.every((x) => x.type === lead.type);
  const { Panel } = elementEditor(lead.type);
  const typeLabel = elementDef(lead.type)?.label.toLowerCase() ?? lead.type;

  return (
    <div className="insp">
      <div className="insp-head">
        <span className="glyph multi">{els.length}</span>
        <span className="title-input static">{sameType ? `${els.length} ${typeLabel} elements` : `${els.length} elements`}</span>
      </div>

      <Section id="multi-align" title="Align">
        <div className="align-row">
          {ALIGNMENTS.map((a) => (
            <button
              key={a.id}
              className="btn icon-btn"
              title={a.title}
              onClick={() =>
                update((p) => {
                  const xs = ids.map((id) => findEl(p, slide.id, id)).filter((x): x is SlideElement => !!x && !x.locked);
                  alignElements(xs, a.id, playhead, fps, clock);
                })
              }
            >
              <PathIcon d={a.d} size={15} />
            </button>
          ))}
        </div>
      </Section>

      <Section id="colour" title="Colour" summary={colourSummary(now.color, now.opacity, lead.colorFrom)}>
        <ColourControl
          color={now.color}
          colorFrom={lead.colorFrom}
          scope={scopeAt(Date.now())}
          onColor={(v) => setAll({ color: v }, "color")}
          onColorFrom={(c, coalesce) =>
            withEach((x) => {
              if (c) x.colorFrom = { ...c };
              else delete x.colorFrom;
            }, coalesce && `${coalesce}-${key}`)
          }
        />
        <label className="field">
          <span className="field-label">
            Opacity <span className="dim mono">{Math.round(now.opacity * 100)}%</span>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={now.opacity} onChange={(e) => setAll({ opacity: Number(e.target.value) }, "opacity")} />
        </label>
      </Section>

      {sameType && Panel ? (
        <>
          <Panel key={lead.id} el={lead} slide={slide} clock={clock} edit={(fn: (x: SlideElement) => void, coalesce?: string) => withEach((x) => x.type === lead.type && fn(x), coalesce && `${coalesce}-${key}`)} />
          <section>
            <Note tone="muted">
              Showing {lead.name}'s settings; changes apply to all {els.length}.
            </Note>
          </section>
        </>
      ) : (
        <section>
          <Note tone="muted">They're different kinds of element, so only what they share is here. Select elements of one kind to edit their own settings together.</Note>
        </section>
      )}

      <section className="row gap wrap">
        <button className="btn small" title="Wrap them in a group (⌘G)" onClick={() => window.dispatchEvent(new Event("morsel:group"))}>
          Group
        </button>
        <button className="btn small" title="Cmd/Ctrl+D" onClick={() => window.dispatchEvent(new Event("morsel:duplicate"))}>
          Duplicate
        </button>
        <button className="btn small danger" title="Delete or Backspace" onClick={() => window.dispatchEvent(new Event("morsel:delete"))}>
          Delete
        </button>
      </section>
    </div>
  );
}

/* ---------------- element ---------------- */

function ElementInspector({ slide, el }: { slide: Slide; el: SlideElement }) {
  const playhead = useStore((s) => s.playhead);
  const fps = useStore((s) => s.project!.fps);
  const keyframeId = useStore((s) => s.keyframeId);
  const { update, set } = useStore.getState();

  const ctx = useEditContext();
  const clock = ctx?.clock ?? { end: slide.durationSec * 1000, outroMs: slide.outroMs ?? 0 };
  const now = snapState(stateAt(el, playhead, clock.end));
  // Which fields are animated: all or nothing when keyed together, per channel when separate.
  const keyed = (c: Channel) => keysFor(el, c).length > 0;
  const selectedKf = el.keyframes.find((k) => k.id === keyframeId) ?? null;
  const { Panel } = elementEditor(el.type);

  const withEl = (fn: (e: SlideElement) => void, coalesce?: string) =>
    update((p) => {
      const e = findEl(p, slide.id, el.id);
      if (e) fn(e);
    }, coalesce);

  const setState = (patch: Partial<AnimState>, field: string) => {
    let kf: string | null = null;
    withEl((e) => (kf = editState(e, patch, playhead, fps, clock)), `state-${el.id}-${field}`);
    if (kf) set({ keyframeId: kf });
  };

  return (
    <div className="insp">
      <div className="insp-head">
        <ElementGlyph type={el.type} />
        <input className="title-input" value={el.name} onChange={(e) => withEl((x) => (x.name = e.target.value), `name-${el.id}`)} onKeyDown={(e) => e.stopPropagation()} />
      </div>

      {selectedKf && (
        <Section
          id="keyframe"
          title={
            <>
              Keyframe
            {selectedKf.channel && (
              <span className={`kf-channel ch-${selectedKf.channel}`}>
                <span className="ch-dot" />
                {CHANNEL_LABELS[selectedKf.channel]}
              </span>
            )}
            {selectedKf.fromEnd && !clock.hold && (
              <span className="kf-channel kf-from-end" title="It's after the outro line, so it stays this far before the end however long the timeline runs">
                <span className="ch-dot" />
                {(selectedKf.t / 1000).toFixed(2)}s before the end
              </span>
            )}
            {clock.hold && (
              <span className={`kf-channel ${selectedKf.fromEnd ? "kf-from-end" : "kf-in"}`} title="Its time within the In or Out, the same however long the Hold">
                <span className="ch-dot" />
                {selectedKf.fromEnd ? "Out" : "In"}
              </span>
            )}
            </>
          }
        >
          <div className="grid2">
            {clock.hold ? (
              // With a Hold: time within the In or Out, which stays the same whatever the data.
              <NumberField
                label="At"
                suffix="ms"
                step={Math.round(1000 / fps)}
                min={0}
                max={selectedKf.fromEnd ? clock.outroMs : clock.hold[0]}
                value={selectedKf.fromEnd ? clock.outroMs - selectedKf.t : selectedKf.t}
                onChange={(v) => withEl((x) => moveKey(x, selectedKf.id, selectedKf.fromEnd ? clock.hold![1] + Math.min(v, clock.outroMs) : Math.min(v, clock.hold![0]), clock, fps), `kf-t-${selectedKf.id}`)}
              />
            ) : (
              <NumberField
                label="At"
                suffix="ms"
                step={Math.round(1000 / fps)}
                min={0}
                max={clock.end}
                value={keyTime(selectedKf, clock.end)}
                onChange={(v) => withEl((x) => moveKey(x, selectedKf.id, v, clock, fps), `kf-t-${selectedKf.id}`)}
              />
            )}
            <select
              title="Easing into this keyframe"
              value={selectedKf.easing}
              onChange={(e) =>
                withEl((x) => {
                  const k = x.keyframes.find((k) => k.id === selectedKf.id);
                  if (k) k.easing = e.target.value as EasingName;
                })
              }
            >
              {EASINGS.map((n) => (
                <option key={n} value={n}>
                  {EASING_LABELS[n]}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn danger small"
            onClick={() => {
              withEl((x) => removeKeyframe(x, selectedKf.id));
              set({ keyframeId: null });
            }}
          >
            Delete keyframe
          </button>
        </Section>
      )}

      <Section id="position" title="Position & size" summary={`${now.x}, ${now.y} · ${now.w}×${now.h}`}>
        <div className="grid2">
          <NumberField label="X" value={now.x} keyed={keyed("position")} onChange={(v) => setState({ x: v }, "x")} />
          <NumberField label="Y" value={now.y} keyed={keyed("position")} onChange={(v) => setState({ y: v }, "y")} />
        </div>
        <div className="size-row">
          <NumberField
            label="W"
            value={now.w}
            min={1}
            keyed={keyed("size")}
            onChange={(v) => setState(el.lockAspect ? { w: v, h: Math.max(1, Math.round((v * now.h) / now.w)) } : { w: v }, "w")}
          />
          <button
            className={`aspect-lock ${el.lockAspect ? "on" : ""}`}
            title={el.lockAspect ? "Aspect ratio locked (Shift while resizing overrides)" : "Lock aspect ratio"}
            aria-pressed={!!el.lockAspect}
            onClick={() => withEl((x) => (x.lockAspect = !x.lockAspect))}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              {el.lockAspect ? (
                <path d="M6.5 9.5l3-3M5 7.5L3.8 8.7a2.5 2.5 0 003.5 3.5L8.5 11M11 8.5l1.2-1.2a2.5 2.5 0 00-3.5-3.5L7.5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M5 7.5L3.8 8.7a2.5 2.5 0 003.5 3.5L8.5 11M11 8.5l1.2-1.2a2.5 2.5 0 00-3.5-3.5L7.5 5M4 4l1.5 1.5M12 12l-1.5-1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <NumberField
            label="H"
            value={now.h}
            min={1}
            keyed={keyed("size")}
            onChange={(v) => setState(el.lockAspect ? { h: v, w: Math.max(1, Math.round((v * now.w) / now.h)) } : { h: v }, "h")}
          />
        </div>
        <div className="row gap">
          <button className="btn small" onClick={() => setState({ x: Math.floor(((ctx?.size.w ?? 64) - now.w) / 2) }, "x")}>
            Centre H
          </button>
          <button className="btn small" onClick={() => setState({ y: Math.floor(((ctx?.size.h ?? 32) - now.h) / 2) }, "y")}>
            Centre V
          </button>
        </div>
      </Section>

      <Section id="colour" title="Colour" summary={colourSummary(now.color, now.opacity, el.colorFrom)}>
        <ColourControl
          color={now.color}
          keyed={keyed("color")}
          colorFrom={el.colorFrom}
          scope={scopeAt(Date.now())}
          onColor={(v) => setState({ color: v }, "color")}
          onColorFrom={(c, coalesce) =>
            withEl((x) => {
              if (c) x.colorFrom = c;
              else delete x.colorFrom;
            }, coalesce && `${coalesce}-${el.id}`)
          }
        />
        <label className="field">
          <span className="field-label">
            Opacity <span className="dim mono">{Math.round(now.opacity * 100)}%</span>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={now.opacity} onChange={(e) => setState({ opacity: Number(e.target.value) }, "opacity")} />
        </label>
      </Section>

      {Panel && <Panel key={el.id} el={el} slide={slide} clock={clock} edit={(fn: (x: SlideElement) => void, coalesce?: string) => withEl((x) => x.type === el.type && fn(x), coalesce)} />}

      <Section id="showif" title="Show only if" summary={el.showIf?.trim() || "Always"} defaultOpen={false}>
        <BindingField kind="any" mode="type" value={el.showIf ?? ""} placeholder="A field, or !field for when it's empty" onChange={(v) => withEl((x) => (x.showIf = v), `showif-${el.id}`)} />
        {el.showIf?.trim() && !conditionHolds(el.showIf, scopeAt(Date.now())) ? (
          <Note tone="warn">
            <b>Hidden right now.</b>
            <span>Draws only while this binding has a value; start with ! for “only when it's empty”.</span>
          </Note>
        ) : (
          <Note tone="muted">Draws only while this binding has a value; start with ! for “only when it's empty”. Blank: always.</Note>
        )}
      </Section>

      <Section id="arrange" title="Arrange" summary="Duplicate, order, group" defaultOpen={false}>
        <div className="row gap wrap">
        <button className="btn small" title="Cmd/Ctrl+D" onClick={() => window.dispatchEvent(new Event("morsel:duplicate"))}>
          Duplicate
        </button>
        <button
          className="btn small"
          onClick={() =>
            update((p) => {
              const list = listOf(p, slide.id, el.id)!;
              const i = list.findIndex((x) => x.id === el.id);
              if (i < list.length - 1) [list[i], list[i + 1]] = [list[i + 1], list[i]];
            })
          }
        >
          Forward
        </button>
        <button
          className="btn small"
          onClick={() =>
            update((p) => {
              const list = listOf(p, slide.id, el.id)!;
              const i = list.findIndex((x) => x.id === el.id);
              if (i > 0) [list[i], list[i - 1]] = [list[i - 1], list[i]];
            })
          }
        >
          Backward
        </button>
        <button className="btn small danger" title="Delete / Backspace" onClick={() => window.dispatchEvent(new Event("morsel:delete"))}>
          Delete
        </button>
        </div>
        <Organise slide={slide} el={el} />
      </Section>
    </div>
  );
}

/** A colour section's summary while folded: a swatch and the opacity, or what picks the colour. */
function colourSummary(color: string, opacity: number, from?: ColorFrom) {
  return (
    <>
      {!from && <span className="well-swatch small" style={{ background: color }} />}
      {from ? `From ${from.value.replace(/^\{\{\s*|\s*\}\}$/g, "")}` : color}
      {opacity < 1 ? ` · ${Math.round(opacity * 100)}%` : ""}
    </>
  );
}

/**
 * Grouping, and moving between containers. Positions stay where they appear
 * on the panel (at the playhead); inside a rotator, keyframe times become item time.
 */
function Organise({ slide, el }: { slide: Slide; el: SlideElement }) {
  const ctx = useEditContext();
  const { update, set, exitTo } = useStore.getState();
  if (!ctx) return null;
  const siblings = ctx.elements.filter((e) => e.id !== el.id && isContainer(e));
  const parent = ctx.levels.at(-1);
  const playhead = useStore.getState().playhead;
  return (
    <div className="row gap wrap">
      <button
        className="btn small"
        title="Wrap it in a group (⌘G)"
        onClick={() => window.dispatchEvent(new Event("morsel:group"))}
      >
        Group
      </button>
      {siblings.length > 0 && (
        <select
          className="btn small"
          value=""
          title="Move it inside a group or rotator next to it"
          onChange={(e) => {
            const target = e.target.value;
            if (!target) return;
            update((p) => {
              const list = listOf(p, slide.id, el.id);
              if (list) moveInto(list, el.id, target, playhead, ctx.duration);
            });
          }}
        >
          <option value="">Move into…</option>
          {siblings.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {parent && (
        <button
          className="btn small"
          title={`Move it out of ${parent.container.name}`}
          onClick={() => {
            const depth = ctx.levels.length;
            const t = parent.kind === "rotator" ? 0 : playhead;
            update((p) => {
              const parentList = listOf(p, slide.id, parent.container.id);
              if (parentList) moveOut(parentList, parent.container.id, el.id, t, parent.end);
            });
            exitTo(depth - 1);
            set({ elementId: el.id });
          }}
        >
          Move out
        </button>
      )}
    </div>
  );
}

/* ---------------- slide ---------------- */

/**
 * The slide's "only when" condition in the playing deck. It's stored on the deck
 * item (the same field as in the Deck tab), so each deck can decide for itself.
 */
function PlayWhen({ slide, deckId, deckName, inDeck }: { slide: Slide; deckId: string; deckName: string; inDeck: boolean }) {
  const { update } = useStore.getState();
  // Select the stable deck list and filter here: a selector returning a new array each time re-renders forever.
  const deckItems = useStore((s) => s.project?.decks.find((d) => d.id === deckId)?.items);
  const items = (deckItems ?? []).filter((i) => i.slideId === slide.id);
  useStore((s) => s.sourceStatus); // re-check the condition when data changes
  const value = items[0]?.showIf ?? "";
  const holds = conditionHolds(value, liveScopeAt(Date.now()));
  return (
    <Section id="playwhen" title="Play only when" summary={!inDeck ? "Not in the deck" : value.trim() ? `${value.trim()} · ${holds ? "playing" : "skipped"}` : "Always"}>
      {inDeck ? (
        <>
          <BindingField
            kind="any"
            mode="type"
            value={value}
            placeholder="A field, or !field for when it's empty"
            scope={liveScopeAt(Date.now())}
            onChange={(v) =>
              update((p) => {
                p.decks.find((d) => d.id === deckId)?.items.forEach((i) => i.slideId === slide.id && (i.showIf = v));
              }, `playwhen-${slide.id}`)
            }
          />
          <Note tone={!value.trim() ? "muted" : holds ? "ok" : "warn"}>
            {value.trim() && <b>{holds ? "Playing right now." : "Skipped right now."}</b>}
            <span>In “{deckName}”, this slide is skipped while the binding is empty or false; start with ! to invert.</span>
          </Note>
        </>
      ) : (
        <>
          <Note tone="muted">Not in “{deckName}” yet. Add it to play it in rotation and give it a condition.</Note>
          <button
            className="btn small"
            onClick={() =>
              update((p) => {
                p.decks.find((d) => d.id === deckId)?.items.push({ id: uid("di_"), slideId: slide.id, enabled: true });
              })
            }
          >
            Add to “{deckName}”
          </button>
        </>
      )}
    </Section>
  );
}

interface RenderInfo {
  frames: number;
  bytes: number;
  dwell: number;
  max: number;
}

/**
 * Plays the slide on the device (a system slide with its sample data). Hovering
 * shows how big its clip is; the button turns amber near the Gen 1 limit.
 */
function SendToDevice({ slide, info }: { slide: Slide; info: RenderInfo | null }) {
  const [hover, setHover] = useState(false);
  const [sent, setSent] = useState(false);
  const heavy = !!info && info.bytes > info.max * 0.85;
  const action = slide.system ? "Preview on device" : "Show on device now";
  return (
    <div className="info-pop" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        className={`info-btn play-btn ${heavy ? "warn" : ""} ${sent ? "sent" : ""}`}
        aria-label={action}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={async () => {
          if (slide.system) await api.sampleNotify(slide.system);
          else await api.showOnDevice(slide.id);
          setSent(true);
          setTimeout(() => setSent(false), 2000);
        }}
      >
        <Icon name={sent ? "check" : "play"} size={sent ? 12 : 10} />
      </button>
      {hover && (
        <div className={`info-pop-panel hover-card ${heavy ? "warn" : ""}`} role="tooltip">
          <b>{sent ? "Sent to the device" : action}</b>
          {info ? (
            <div className="device-info">
              <div>
                <span className="mono">{info.frames}</span> frame{info.frames === 1 ? "" : "s"} · <span className="mono">{(info.bytes / 1024).toFixed(1)} KB</span>
                <span className="dim"> of {Math.round(info.max / 1024)} KB max</span>
              </div>
              <div className="meter">
                <div style={{ width: `${Math.min(100, (info.bytes / info.max) * 100)}%` }} />
              </div>
              {heavy && <span>Close to the Gen 1 limit. Shorten the slide, lower the frame rate or simplify the motion.</span>}
            </div>
          ) : (
            <span className="dim">Measuring…</span>
          )}
        </div>
      )}
    </div>
  );
}

/** What a system slide is for and the fields it can bind to, tucked into a popover. */
function SystemSlideInfo({ slide }: { slide: Slide }) {
  const kind = SYSTEM_KINDS.find((k) => k.kind === slide.system);
  const fields = slide.system === "dnd" ? ["dnd.until", "dnd.until12", "dnd.on"] : NOTIFY_FIELDS.map((f) => `notify.${f}`);
  return (
    <InfoPopover label="About this system slide">
      <div>
        <b>System slide.</b> {kind?.description}
      </div>
      <div className="info-pop-fields">
        {fields.map((f) => (
          <code key={f}>{`{{${f}}}`}</code>
        ))}
      </div>
      {slide.system !== "dnd" && <div className="dim">Text that scrolls once stretches a notification so it can finish; the duration here is the shortest it plays.</div>}
    </InfoPopover>
  );
}

/**
 * Inside a rotator with nothing selected: its items' timing, beside the item
 * timeline it shapes. (The rotator's list and playback are on the rotator itself.)
 */
function ItemInspector({ slide, level }: { slide: Slide; level: Level }) {
  const { update } = useStore.getState();
  useStore((s) => s.sourceStatus); // the items' lengths follow the data
  const el = level.container as RotatorElement;
  const scope = scopeAt(Date.now());
  const durations = rotatorSchedule(el, scope, { holdNeedMs }, rotatorItems(el, scope));
  const edit = (fn: (x: RotatorElement) => void, coalesce?: string) =>
    update((p) => {
      const x = findEl(p, slide.id, el.id);
      if (x?.type === "rotator") fn(x);
    }, coalesce);
  return (
    <div className="insp">
      <div className="insp-head">
        <ElementGlyph type="rotator" />
        <span className="title-input static">{el.name} · each item</span>
      </div>
      <Section id="item-timing" title="Each item" summary={timingSummary(el, durations)}>
        <ItemTiming el={el} slide={slide} durations={durations} parentEnd={level.end} edit={edit} />
      </Section>
    </div>
  );
}

function SlideInspector({ slide }: { slide: Slide }) {
  const { update } = useStore.getState();
  const savedAt = useStore((s) => s.savedAt);
  const project = useStore((s) => s.project!);
  const [info, setInfo] = useState<RenderInfo | null>(null);

  useEffect(() => {
    let alive = true;
    api.renderInfo(slide.id).then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [slide.id, savedAt]);

  const withSlide = (fn: (s: Slide) => void, coalesce?: string) =>
    update((p) => {
      const s = findSlide(p, slide.id);
      if (s) fn(s);
    }, coalesce);

  const deck = project.decks.find((d) => d.id === project.activeDeckId);
  const inDeck = deck?.items.some((i) => i.slideId === slide.id);
  const tr = slide.transition;
  useStore((s) => s.sourceStatus); // fitted lengths follow the data
  const fitted = fittedSec(slide, scopeAt(Date.now(), slide));

  return (
    <div className="insp">
      <div className="insp-head">
        <span className="glyph">
          <Icon name="slide" size={12} />
        </span>
        <input className="title-input" value={slide.name} onChange={(e) => withSlide((s) => (s.name = e.target.value), `slide-name-${slide.id}`)} onKeyDown={(e) => e.stopPropagation()} />
        <SendToDevice slide={slide} info={info} />
        {slide.system && <SystemSlideInfo slide={slide} />}
      </div>

      <Section id="slide" title="Slide" summary={slide.fit ? `Fits its content · ${fitted}s now` : `${slide.durationSec}s`}>
        <TimingFields
          noun="slide"
          timing={slide}
          elements={slide.elements}
          onMode={(v) =>
            withSlide((s) => {
              // Either way it looks the same as now: fitting turns its keys into an In and an Out around a Hold.
              if (v === "fixed") fixSlideLength(s, fitted);
              else fitSlideToContent(s);
            })
          }
          edit={(fn, key) => withSlide((s) => fn(s, s.elements), key && `slide-${key}-${slide.id}`)}
          length={<NumberField label="Duration" suffix="s" min={1} max={290} value={slide.durationSec} onChange={(v) => withSlide((s) => (s.durationSec = Math.round(v)), `dur-${slide.id}`)} />}
          fittedNow={
            <>
              Plays for <b className="mono">{fitted}s</b> right now
            </>
          }
        />
        <ColorField label="Background" value={slide.background} onChange={(v) => withSlide((s) => (s.background = v), `bg-${slide.id}`)} />
      </Section>

      {!slide.system && deck && <PlayWhen slide={slide} deckId={deck.id} deckName={deck.name} inDeck={!!inDeck} />}

      <Section id="transition" title="Entry transition" summary={tr.type === "cut" ? TRANSITION_LABELS.cut : `${TRANSITION_LABELS[tr.type]} · ${tr.durationMs}ms`}>
        <label className="field">
          <span className="field-label">Style</span>
          <select value={tr.type} onChange={(e) => withSlide((s) => (s.transition.type = e.target.value as TransitionType))}>
            {(Object.keys(TRANSITION_LABELS) as TransitionType[]).map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {DIRECTIONAL.includes(tr.type) && (
          <Segmented
            value={tr.direction}
            options={(["left", "right", "up", "down"] as Direction[]).map((d) => ({ value: d, label: <Icon name={({ left: "arrowLeft", right: "arrowRight", up: "arrowUp", down: "arrowDown" } as const)[d]} size={13} />, title: d }))}
            onChange={(v) => withSlide((s) => (s.transition.direction = v))}
          />
        )}
        {tr.type !== "cut" && (
          <>
            <NumberField label="Length" suffix="ms" step={50} min={50} max={slide.durationSec * 1000} value={tr.durationMs} onChange={(v) => withSlide((s) => (s.transition.durationMs = v), `trd-${slide.id}`)} />
            <label className="field">
              <span className="field-label">Easing</span>
              <select value={tr.easing} onChange={(e) => withSlide((s) => (s.transition.easing = e.target.value as EasingName))}>
                {EASINGS.map((n) => (
                  <option key={n} value={n}>
                    {EASING_LABELS[n]}
                  </option>
                ))}
              </select>
            </label>
            <Note tone="muted">Plays over the start of this slide, from the end of whichever slide came before it.</Note>
          </>
        )}
      </Section>
    </div>
  );
}
