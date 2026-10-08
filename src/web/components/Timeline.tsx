import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHANNEL_LABELS, CHANNELS, isSeparate, keysFor, keyTime, mergeIsExact, mergeKeyframes, resolveKeys, snapState, sortedKeyframes, splitKeyframes, stateAt, type Clock } from "../../shared/animate";
import { marqueeTiming, onceEndMs, restMs, scrollExtent, type TextElement } from "../../elements/text/element";
import { TRANSITION_LABELS } from "../../shared/transitions";
import type { Channel, Keyframe, SlideElement } from "../../shared/types";
import { isContainer } from "../../elements/tree";
import { holdNeedMs, onClock } from "../../elements";
import { addKeyframe, applyPreset, findEl, findSlide, isExitPreset, listOf, moveKey, PRESET_MS, PRESETS, setOutroOn, snapTime, type PresetId } from "../model";
import { phaseMinimumsOf, setPhaseOn } from "../../elements/phases";
import type { Timing } from "../../shared/timing";
import { HOLD_VIEW_MS, timeView } from "../timeview";
import type { Project } from "../../shared/types";
import { elementEditor } from "../../elements/editors";
import type { TimelineTrack } from "../../elements/types";
import { scopeAt, selectionOf, useEditContext, useSelection, useStore } from "../store";
import { confirmDialog } from "./Dialogs";
import { Segmented } from "./Fields";
import { ElementGlyph } from "./ElementGlyph";
import { Icon } from "./Icon";

const fmt = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

/** Width of the layer-name column, and the gap either side of the tracks. */
const LABEL_W = 190;
const PAD = 14;
const MAX_ZOOM = 40;
/** Ruler spacings to choose from (ms): the smallest that leaves room for a label wins. */
const TICK_STEPS = [100, 200, 250, 500, 1000, 2000, 5000, 10000];
const MIN_TICK_PX = 46;
/**
 * Timeline zoom, the way animation apps do it: 1 fits the whole slide; pinch or
 * ⌘/Ctrl+scroll zooms around the pointer; horizontal scroll pans; while playing,
 * the view pages along to keep the playhead in sight.
 */
function useTimelineZoom(bodyRef: React.RefObject<HTMLDivElement | null>, slideId: string | undefined, dur: number) {
  const [zoom, setZoom] = useState(1);
  const [bodyW, setBodyW] = useState(0);
  // Where the zoom anchor should land once the new width has rendered.
  const pending = useRef<{ t: number; x: number } | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setBodyW(el.clientWidth); // now, not only when the observer first reports
    const ro = new ResizeObserver(() => setBodyW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [bodyRef, slideId]);

  // Each slide starts fitted.
  useEffect(() => {
    setZoom(1);
    bodyRef.current?.scrollTo({ left: 0 });
  }, [bodyRef, slideId]);

  const fitW = Math.max(120, bodyW - LABEL_W - 2 * PAD);
  const trackW = fitW * zoom;

  /** Zooms keeping the moment under screen x (default: the middle of the tracks) where it is. */
  const zoomTo = useCallback(
    (next: number, clientX?: number) => {
      const el = bodyRef.current;
      if (!el || !dur) return;
      const r = el.getBoundingClientRect();
      const x = (clientX ?? r.left + LABEL_W + (r.width - LABEL_W) / 2) - r.left;
      const t = ((el.scrollLeft + x - LABEL_W - PAD) / (fitW * zoom)) * dur;
      pending.current = { t: Math.max(0, Math.min(dur, t)), x };
      setZoom(Math.max(1, Math.min(MAX_ZOOM, next)));
    },
    [bodyRef, dur, fitW, zoom],
  );

  useLayoutEffect(() => {
    const el = bodyRef.current;
    const p = pending.current;
    if (!el || !p) return;
    pending.current = null;
    el.scrollLeft = LABEL_W + PAD + (p.t / dur) * trackW - p.x;
  }, [bodyRef, zoom, trackW, dur]);

  // Pinch / ⌘-scroll zooms; everything else scrolls normally. Needs a non-passive listener.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomTo(zoom * Math.exp(-e.deltaY * 0.01), e.clientX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [bodyRef, zoom, zoomTo]);

  return { zoom, trackW, zoomTo };
}

export function Timeline() {
  const slide = useStore((s) => (s.project ? findSlide(s.project, s.slideId) : null));
  const fps = useStore((s) => s.project?.fps ?? 20);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const elementId = useStore((s) => s.elementId);
  const keyframeId = useStore((s) => s.keyframeId);
  const { set, update, selectElement, toggleSelected, enter } = useStore.getState();
  const selection = useSelection();
  /** Clicking an element's track: it leads, keeping the rest of the selection if it's part of it. */
  const lead = (id: string) => {
    const ids = selectionOf(useStore.getState());
    if (ids.includes(id)) set({ elementId: id, selected: ids, keyframeId: null });
    else selectElement(id);
  };
  const rulerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Elements keyed separately whose channel rows are showing.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The edge being dragged (an In or Out, or the outro line), for its length tag.
  const [resizing, setResizing] = useState<"in" | "out" | "outro" | null>(null);
  // This level's clock: the slide's, or one item's inside a rotator.
  const ctx = useEditContext();
  const dur = ctx?.duration ?? (slide?.durationSec ?? 0) * 1000;
  const clock: Clock = ctx?.clock ?? { end: dur, outroMs: slide?.outroMs ?? 0 };
  // In a Hold, its start is drawn at real scale up to the latest "Start after" of the text scrolling there, so those flags sit true.
  const leadMs = clock.hold
    ? Math.max(0, ...[...onClock(ctx?.elements ?? slide?.elements ?? [])].filter((x): x is TextElement => x.type === "text" && x.overflow === "marquee").map((x) => marqueeTiming(x).startMs))
    : 0;
  const view = timeView(clock, leadMs);
  const levelKey = `${slide?.id}:${ctx?.levels.map((l) => l.container.id).join("/") ?? ""}`;
  const { zoom, trackW, zoomTo } = useTimelineZoom(bodyRef, levelKey, view.total);

  // While playing zoomed in, page along so the playhead stays in view.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !playing || zoom <= 1 || !view.total) return;
    const x = LABEL_W + PAD + (view.toView(playhead) / view.total) * trackW;
    if (x < el.scrollLeft + LABEL_W + PAD || x > el.scrollLeft + el.clientWidth - PAD) el.scrollLeft = x - LABEL_W - PAD;
  }, [playhead, playing, zoom, trackW, view]);

  if (!slide) return <div className="timeline" />;
  /** Where time t sits along the track, and how wide the stretch from a to b is (as CSS percentages). */
  const at = (t: number) => (view.toView(Math.max(0, Math.min(dur, t))) / view.total) * 100;
  const pct = (t: number) => `${at(t)}%`;
  const span = (a: number, b: number) => ({ left: pct(a), width: `${Math.max(0, at(b) - at(a))}%` });
  const elements = ctx?.elements ?? slide.elements;
  const hold = clock.hold;
  // The outro line of a fixed-length timeline (the slide's, or a rotator's items'): keys after it count back from the end. (Fitted, there's an In and Out instead.)
  const outroAt = !hold && clock.outroMs > 0 ? Math.max(0, dur - clock.outroMs) : null;
  const outroShade = outroAt != null && <div className="tl-outro" style={span(outroAt, dur)} />;
  /** A stretch of the track in view units (for the parts of a Hold drawn from settings). */
  const vspan = (v0: number, v1: number) => ({ left: `${(v0 / view.total) * 100}%`, width: `${(Math.max(0, v1 - v0) / view.total) * 100}%` });
  // Fitted, behind every row: the In (keys count from the start), the Hold, and the Out (keys count from the end, like an outro).
  const holdBand = hold && (
    <>
      <div className="tl-intro" style={vspan(0, hold[0])} />
      <div className="tl-hold-band" style={vspan(hold[0], view.outStart!)} />
      <div className="tl-outro" style={vspan(view.outStart!, view.total)} />
    </>
  );
  // Whose timing this is (outro line, or In, Hold and Out): the rotator whose item this is, or the slide.
  const phaseOwnerId = ctx?.outroOwner ?? null;
  const noun = phaseOwnerId ? "item" : "slide";
  const phaseOwner = (p: Project): { owner: Timing; elements: SlideElement[] } | null => {
    if (phaseOwnerId) {
      const r = findEl(p, slide.id, phaseOwnerId);
      return r?.type === "rotator" ? { owner: r, elements: r.children } : null;
    }
    const s = findSlide(p, slide.id);
    return s ? { owner: s, elements: s.elements } : null;
  };
  const selected = elements.find((e) => e.id === elementId) ?? null;

  /** The fraction of the way along the ruler at screen x. */
  const fracAt = (clientX: number) => {
    const r = rulerRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const timeFromEvent = (clientX: number) => Math.max(0, Math.min(dur, snapTime(view.fromView(fracAt(clientX) * view.total), fps)));

  const scrub = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    set({ playing: false, playhead: timeFromEvent(e.clientX), keyframeId: null });
  };
  const scrubMove = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) set({ playhead: timeFromEvent(e.clientX) });
  };

  const dragKey = (e: React.PointerEvent, el: SlideElement, kfId: string, t: number) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    set({ playing: false, playhead: t, elementId: el.id, keyframeId: kfId });
  };
  const dragKeyTo = (e: React.PointerEvent, el: SlideElement, kfId: string) => {
    if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return;
    const t = timeFromEvent(e.clientX);
    update((p) => {
      const x = findEl(p, slide.id, el.id);
      if (x) moveKey(x, kfId, t, clock, p.fps); // past the outro line, it counts from the end
    }, `kf-move-${kfId}`);
    set({ playhead: t });
  };

  /** Dragging the outro line: to the very end removes it. Snaps to keys nearby. */
  const dragOutro = (e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return;
    let t = timeFromEvent(e.clientX);
    const snapMs = 6 / pxPerMs;
    const keyTimes = [...onClock(elements)].flatMap((x) => x.keyframes.map((k) => keyTime(k, dur)));
    const near = keyTimes.reduce((best, kt) => (Math.abs(kt - t) < Math.abs(best - t) ? kt : best), Infinity);
    if (Math.abs(near - t) <= snapMs) t = near;
    if (dur - t < snapMs) t = dur;
    update((p) => {
      const o = phaseOwner(p);
      if (o) setOutroOn(o.owner, o.elements, snapTime(dur - t, p.fps), dur);
    }, `outro-${levelKey}`);
  };

  /**
   * Dragging the In or Out edge (either side of the Hold). The Hold keeps its
   * width on screen, so the length comes from where the edge sits along the whole track.
   */
  const dragPhase = (e: React.PointerEvent, phase: "in" | "out") => {
    if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId) || !hold) return;
    const f = Math.min(0.98, Math.max(0.02, fracAt(e.clientX)));
    const [inMs, outMs] = [hold[0], dur - hold[1]];
    // Each edge's place along the track, the Hold a fixed W wide: the In ends at in / total, the Out starts at (in + W) / total.
    const W = leadMs + HOLD_VIEW_MS;
    const ms = phase === "in" ? (f * (W + outMs)) / (1 - f) : (inMs + W) / f - (inMs + W);
    update((p) => {
      const o = phaseOwner(p);
      if (o) setPhaseOn(o.owner, o.elements, phase, snapTime(Math.max(0, ms), p.fps));
    }, `phase-${phaseOwnerId ?? slide.id}-${phase}`);
  };

  const rows = [...elements].reverse(); // top-most layer first
  /** An element with its keys at their times on this timeline (some may count from its end). */
  const timed = (el: SlideElement) => resolveKeys(el, dur);

  const toggleExpanded = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const setKeyMode = async (mode: "together" | "separate") => {
    if (!selected || (selected.keyMode ?? "together") === mode) return;
    if (mode === "together" && !mergeIsExact(selected, dur)) {
      const ok = await confirmDialog({
        title: "Key everything together?",
        message: "Its position, size, colour and opacity have different timings. Together, they share one set of keyframes, so some moves may ease a little differently.",
        confirmLabel: "Merge keyframes",
      });
      if (!ok) return;
    }
    update((p) => {
      const el = findEl(p, slide.id, selected.id);
      if (el) mode === "separate" ? splitKeyframes(el) : mergeKeyframes(el, dur);
    });
    set({ keyframeId: null });
    if (mode === "separate") toggleExpanded(selected.id, true);
  };

  /** When a key is, as its tooltip says it: with a Hold, within its In or Out. */
  const keyWhen = (t: number) => {
    if (hold) return t <= hold[0] ? `In ${fmt(t)}` : `Out +${fmt(t - hold[1])}`;
    return outroAt != null && t >= outroAt ? `${fmt(t)} · ${fmt(dur - t)} before the end` : fmt(t);
  };

  /** Diamonds and easing segments for time-ordered keyframes (one channel's, or all of them). */
  // Keys are passed in resolved (see timed()): each at its time on this timeline, in order.
  const keyTrack = (el: SlideElement, ks: Keyframe[], channel?: Channel) => (
    <>
      {ks.slice(1).map((k, i) => (
        <div key={`seg-${k.id}`} className="seg" style={span(ks[i].t, k.t)} title={k.easing} />
      ))}
      {ks.map((k) => (
        <div
          key={k.id}
          className={`diamond ${k.id === keyframeId ? "active" : ""}`}
          style={{ left: pct(k.t) }}
          title={`${channel ? `${CHANNEL_LABELS[channel]} · ` : ""}${keyWhen(k.t)} · ${k.easing}`}
          onPointerDown={(e) => dragKey(e, el, k.id, k.t)}
          onPointerMove={(e) => dragKeyTo(e, el, k.id)}
        />
      ))}
    </>
  );

  /**
   * A collapsed separately-keyed row: every channel's keys (and the element's
   * own tracks, like when text starts scrolling) as small coloured ghosts, one lane each.
   */
  const ghostTrack = (el: SlideElement, tracks: TimelineTrack<SlideElement>[]) => {
    // Only channels with keys get a lane; the lanes stack together, centred in the row.
    const keyed = CHANNELS.map((c) => ({ c, ks: keysFor(timed(el), c) })).filter(({ ks }) => ks.length);
    const lanes = keyed.length + tracks.length;
    const pitch = Math.min(6, 28 / Math.max(1, lanes)); // roomier when there are only a few
    const top = (lane: number) => (28 - lanes * pitch) / 2 + lane * pitch + (pitch - 5) / 2;
    return (
      <>
        {keyed.map(({ c, ks }, lane) => {
          return (
            <div key={c} className={`ghost-lane ch-${c}`} style={{ top: top(lane) }}>
              {ks.length > 1 && <div className="ghost-line" style={span(ks[0].t, ks[ks.length - 1].t)} />}
              {ks.map((k) => (
                <div key={k.id} className={`ghost ${k.id === keyframeId ? "active" : ""}`} style={{ left: pct(k.t) }} />
              ))}
            </div>
          );
        })}
        {tracks.map((tr, i) => (
          <div key={tr.id} className={`ghost-lane ch-${tr.id}`} style={{ top: top(keyed.length + i) }}>
            {trackSummary(tr, "ghost")}
          </div>
        ))}
      </>
    );
  };

  /** Slide-time span, clamped to the slide, as left/width percentages. */
  const spanStyle = (sp: { start: number; end: number | null }) => span(sp.start, Math.min(dur, sp.end ?? dur));

  /**
   * A track drawn small, without dragging: as a ghost lane (keyed separately),
   * or as a strip along the bottom of a collapsed row (keyed together).
   */
  const trackSummary = (tr: TimelineTrack<SlideElement>, kind: "ghost" | "strip") => (
    <>
      {tr.spans.map((sp, i) => (
        <div key={i} className={`${kind}-line ${sp.faded ? "faded" : ""}`} style={spanStyle(sp)} />
      ))}
      {tr.markers.map((m) => (
        <div key={m.id} className={`${kind}-marker ${m.shape}`} style={{ left: pct(m.t) }} />
      ))}
    </>
  );

  /** An element's own timeline row: its spans, and markers to drag. */
  const trackRow = (el: SlideElement, tr: TimelineTrack<SlideElement>) => (
    <div key={tr.id} className={`tl-row tl-channel ch-${tr.id} ${selection.includes(el.id) ? "selected" : ""}`}>
      <div className="tl-label" onClick={(e) => (e.shiftKey ? toggleSelected(el.id) : selectElement(el.id))}>
        <span className="ch-dot" />
        <span className="name">{tr.label}</span>
      </div>
      <div
        className="tl-track"
        onPointerDown={(e) => {
          lead(el.id);
          scrub(e);
        }}
        onPointerMove={scrubMove}
      >
        {tr.spans.map((sp, i) => (
          <div key={i} className={`track-span ${sp.faded ? "faded" : ""}`} style={spanStyle(sp)} title={sp.title} />
        ))}
        {tr.markers.map((m) => (
          <div
            key={m.id}
            className={`track-marker ${m.shape}`}
            style={{ left: pct(m.t) }}
            title={m.title}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              set({ playing: false, playhead: m.t, elementId: el.id, keyframeId: null });
            }}
            onPointerMove={(e) => {
              if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return;
              const t = timeFromEvent(e.clientX);
              update((p) => {
                const x = findEl(p, slide.id, el.id);
                if (x) m.move(x, t);
              }, `track-${el.id}-${tr.id}-${m.id}`);
              set({ playhead: t });
            }}
          />
        ))}
        {outroShade}
        {holdBand}
        <div className="playhead" style={{ left: pct(playhead) }} />
      </div>
    </div>
  );

  const reorder = (dragId: string, targetId: string) => {
    update((p) => {
      const list = listOf(p, slide.id, dragId);
      if (!list || !list.some((e) => e.id === targetId)) return;
      const [moved] = list.splice(list.findIndex((e) => e.id === dragId), 1);
      // Rows are reversed, so dropping on a row places the layer above it.
      list.splice(list.findIndex((e) => e.id === targetId) + 1, 0, moved);
    });
  };

  // Labelled ticks as dense as the zoom allows, with unlabelled ones between.
  // With a Hold, the In counts from its start and the Out from its own ("+0.2s"); the Hold has none.
  const pxPerMs = trackW / view.total;
  const step = TICK_STEPS.find((ms) => ms * pxPerMs >= MIN_TICK_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const minor = step / (step * pxPerMs >= 5 * 12 ? 5 : 2);
  const tickLabel = (t: number) => `${Number((t / 1000).toFixed(2))}s`;
  // Where two stretches meet (In and Hold, Hold and Out) both would put a tick: the first one drawn there stays.
  // Each tick's key is its place on the track, so no two share one and React never keeps a stale one around.
  const ticks: { t: number; at: number; major: boolean; label: string }[] = [];
  const addTicks = (from: number, to: number, label: (o: number) => string) => {
    for (let i = 0; i * minor <= to - from + 0.5; i++) {
      const o = Math.round(i * minor);
      const at = Math.round(view.toView(from + o) * 100) / 100;
      if (ticks.some((x) => Math.abs(x.at - at) < 0.5)) continue;
      const major = Math.round(o / step) * step === o;
      ticks.push({ t: from + o, at, major, label: major ? label(o) : "" });
    }
  };
  if (hold) {
    // The In from its start, the Out from its own ("+0.2s"); the Hold's real-scale start gets unlabelled ticks, the rest none.
    addTicks(0, hold[0], tickLabel);
    addTicks(hold[0], hold[0] + Math.min(leadMs, hold[1] - hold[0]), () => ""); // the band's label sits there
    addTicks(hold[1], dur, (o) => (o ? `+${tickLabel(o)}` : ""));
  } else addTicks(0, dur, tickLabel);

  /** Pointer handlers for an edge that resizes something, showing its length while it's held. */
  const resizeGrip = (which: "in" | "out" | "outro") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      set({ playing: false });
      setResizing(which);
    },
    onLostPointerCapture: () => setResizing(null),
  });

  /** The length tag beside an edge while it's dragged: on the `side` of it where there's room. */
  const lengthTag = (t: number, side: "left" | "right", text: string) => <div className={`tl-length-tag ${side}`} style={{ left: pct(t) }}>{text}</div>;

  // What the data does with this timeline right now, which the timeline's layout leaves out: how
  // long this item (or fitted slide) holds and why (what its content needs, or "Hold at least"),
  // and which scrolling text fits and so stays still.
  const readout = (() => {
    if (!hold) return null;
    const level = ctx?.levels.at(-1);
    const who = phaseOwnerId && level?.kind === "rotator" && level.item != null ? `Item ${level.item + 1}` : phaseOwnerId ? "This item" : "The slide";
    const sc = scopeAt(Date.now());
    const len = hold[1] - hold[0];
    const min = clock.holdMin ?? 0;
    const content = [...onClock(elements)];
    const still = content.filter((x): x is TextElement => {
      if (x.type !== "text" || x.overflow !== "marquee") return false;
      const { content, box } = scrollExtent({ ...x, keyframes: [], state: snapState(stateAt(x, hold[0], dur)) }, sc);
      return content <= box;
    });
    const fits = still.length ? ` · ${still.map((x) => x.name).join(", ")} ${still.length === 1 ? "fits" : "fit"}, so won't scroll` : "";
    // Whatever needs the longest Hold, and what that is made of.
    const top = content.map((x) => ({ x, need: holdNeedMs([x], sc, hold[0]) })).reduce<{ x: SlideElement; need: number } | null>((m, n) => (n.need > (m?.need ?? 0) ? n : m), null);
    const why = (() => {
      if (!top || top.need <= min) return `its “Hold at least”${top ? ` (${top.x.name} needs only ${fmt(top.need)})` : ""}`;
      const x = top.x;
      if (x.type !== "text") return `${x.name} needs ${fmt(top.need)}`;
      const t = { ...x, keyframes: [], state: snapState(stateAt(x, hold[0], dur)) };
      const { content: c, box } = scrollExtent(t, sc);
      const start = marqueeTiming(t).startMs;
      const parts = [start && `waits ${fmt(start)}`, `scrolls ${fmt(onceEndMs(t, c, box) - start)}`, restMs(t) && `rests ${fmt(restMs(t))}`].filter(Boolean);
      return `${x.name} ${parts.join(", ")}${min ? ` (more than the ${fmt(min)} at least)` : ""}`;
    })();
    // Longer than that: a rotator's item holds on until the slide ends (it's the last, or the next
    // wouldn't fit); a fitted slide plays whole seconds.
    const slack = len - Math.max(min, top?.need ?? 0);
    const extra = slack > 1 ? ` · +${fmt(slack)} ${phaseOwnerId ? "holding on until the slide ends" : "to make whole seconds"}` : "";
    return `${who} holds ${fmt(len)}: ${why}${extra}${fits}`;
  })();

  // The slide's outro line on the ruler: unset, a tab at the end waiting to be dragged left.
  const outroHandle = (
    <>
      {outroShade}
      <div
        className={`tl-outro-handle ${outroAt == null ? "unset" : ""}`}
        style={{ left: pct(outroAt ?? dur) }}
        title={
          resizing
            ? undefined
            : outroAt == null
              ? `Outro line. Drag it left: keys after it count back from the end of the ${noun}, so exits stay at the end however long it runs.`
              : `Outro: the last ${fmt(clock.outroMs)}. Keys after the line count back from the end of the ${noun}, so they stay at the end however long it runs. Drag it to the end to remove it.`
        }
        {...resizeGrip("outro")}
        onPointerMove={dragOutro}
      />
      {resizing === "outro" && lengthTag(outroAt ?? dur, "left", clock.outroMs ? `Outro ${fmt(clock.outroMs)}` : "No outro")}
    </>
  );

  // The phases on the ruler (a rotator item's, or a fitted slide's): the In and Out at real scale, with
  // edges to drag, and between them the Hold, one block of a fixed width, as long as the content needs.
  const phaseRuler = ([a, b]: [number, number]) => {
    const container = ctx?.levels.find((l) => l.container.id === phaseOwnerId)?.container;
    const mins = phaseMinimumsOf(phaseOwnerId ? ((container as { children?: SlideElement[] })?.children ?? []) : slide.elements, phaseOwnerId ? (container as Timing | undefined) : slide);
    const holdMin = clock.holdMin ?? 0;
    const outStart = view.outStart!;
    const vpct = (v: number) => `${(v / view.total) * 100}%`;
    const every = phaseOwnerId ? ", the same for every item" : "";
    const edge = (phase: "in" | "out", v: number, title: string) => (
      <div className={`tl-phase-handle ${phase}`} style={{ left: vpct(v) }} title={resizing ? undefined : title} {...resizeGrip(phase)} onPointerMove={(e) => dragPhase(e, phase)} />
    );
    const tag = (v: number, side: "left" | "right", text: string) => <div className={`tl-length-tag ${side}`} style={{ left: vpct(v) }}>{text}</div>;
    const shortest = (ms: number, min: number) => (min > 0 && ms <= min ? " · shortest its keys allow" : "");
    return (
      <>
        <div className="tl-intro" style={vspan(0, a)} />
        <div className="tl-outro" style={vspan(outStart, view.total)} />
        <div
          className="tl-hold"
          style={vspan(a, outStart)}
          title={`Hold: as long as the content needs (text scrolling, then resting), but at least ${fmt(holdMin)}. Nothing is keyed here. Always drawn this wide; ${phaseOwnerId ? "this item" : "the slide"} holds ${fmt(b - a)} with the data right now.`}
        >
          Hold ≈ as long as needed
        </div>
        {edge("in", a, `In: ${fmt(a)}${every}. Drag to change${mins.inMs ? ` (keys need at least ${fmt(mins.inMs)})` : ""}.`)}
        {edge("out", outStart, `Out: ${fmt(dur - b)}${every}. Drag to change${mins.outMs ? ` (keys need at least ${fmt(mins.outMs)})` : ""}.`)}
        {resizing === "in" && tag(a, "right", `In ${fmt(a)}${shortest(a, mins.inMs)}`)}
        {resizing === "out" && tag(outStart, "left", `Out ${fmt(dur - b)}${shortest(dur - b, mins.outMs)}`)}
      </>
    );
  };

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <button className="btn icon-btn" title="Play / pause (Space)" onClick={() => set({ playing: !playing })}>
          <Icon name={playing ? "pause" : "play"} size={13} />
        </button>
        <span className="tl-time mono">
          {fmt(playhead)} <span className="dim">/ {fmt(dur)}</span>
        </span>
        {readout && (
          <span className="tl-readout dim small" title="With the data right now. The timeline itself is drawn from settings, so it looks the same whatever the data.">
            {readout}
          </span>
        )}
        <div className="spacer" />
        {selected && (
          <Segmented
            value={selected.keyMode ?? "together"}
            options={[
              { value: "together", label: "Together", title: "Each keyframe keys position, size, colour and opacity at once" },
              { value: "separate", label: "Separate", title: "Position, size, colour and opacity each get their own keyframes and timing" },
            ]}
            onChange={setKeyMode}
          />
        )}
        <button
          className="btn"
          disabled={!selected}
          title={selected && isSeparate(selected) ? "Key every channel at the playhead (K)" : selection.length > 1 ? `Key each of the ${selection.length} selected elements at the playhead (K)` : "Key the whole element at the playhead (K)"}
          onClick={() => {
            let kf: string | null = null;
            update((p) => {
              for (const id of selection) {
                const el = findEl(p, slide.id, id);
                const k = el && addKeyframe(el, playhead, p.fps, clock);
                if (id === elementId) kf = k ?? null;
              }
            });
            set({ keyframeId: kf, selected: selection });
          }}
        >
          <Icon name="keyframe" size={11} /> Keyframe
        </button>
        <select
          className="btn"
          value=""
          disabled={!selected}
          onChange={(e) => {
            const preset = e.target.value as PresetId;
            update((p) => {
              const els = selection.map((id) => findEl(p, slide.id, id)).filter((x): x is SlideElement => !!x);
              if (!els.length) return;
              let c = clock;
              const exit = isExitPreset(preset);
              if (hold) {
                // A rotator item or a fitted slide: enters play in its In, exits in its Out, which grow to fit the move if they need to.
                const o = phaseOwner(p);
                if (!o) return;
                const [inMs, outMs] = [hold[0], dur - hold[1]];
                if (exit) setPhaseOn(o.owner, o.elements, "out", Math.max(outMs, PRESET_MS));
                else setPhaseOn(o.owner, o.elements, "in", Math.max(inMs, Math.min(playhead, inMs) + PRESET_MS));
                const now = { inMs: o.owner.inMs ?? inMs, outMs: o.owner.outMs ?? outMs };
                const holdLen = hold[1] - hold[0];
                c = { end: now.inMs + holdLen + now.outMs, outroMs: now.outMs, hold: [now.inMs, now.inMs + holdLen] };
              } else if (exit && clock.outroMs < PRESET_MS) {
                // A fixed length: exits count back from its end, so the outro line moves back to make room if it needs to.
                const o = phaseOwner(p);
                if (o) setOutroOn(o.owner, o.elements, PRESET_MS, dur);
                c = { end: dur, outroMs: PRESET_MS };
              }
              for (const el of els) applyPreset(el, preset, c, hold ? Math.min(playhead, hold[0]) : playhead, p.fps);
            });
          }}
        >
          <option value="">Animate…</option>
          {(["Enter", "Exit", "Loop"] as const).map((g) => (
            <optgroup key={g} label={g}>
              {PRESETS.filter((p) => p.group === g && !(hold && p.group === "Loop")).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          className="btn"
          disabled={!elements.some((x) => selection.includes(x.id) && x.keyframes.length)}
          title={selection.length > 1 ? "Remove all keyframes from the selected elements" : "Remove all keyframes from this element"}
          onClick={() =>
            update((p) => {
              for (const id of selection) {
                const el = findEl(p, slide.id, id);
                if (el && el.keyframes.length) {
                  el.state = { ...stateAt(el, 0, dur) };
                  el.keyframes = [];
                }
              }
              set({ keyframeId: null, selected: selection });
            })
          }
        >
          Clear keys
        </button>
        <div className="zoom-bar inline">
          <button className="mini" title="Zoom out (or pinch / ⌘ scroll)" disabled={zoom <= 1} onClick={() => zoomTo(zoom / 1.5)}>
            −
          </button>
          <span className="mono small" title="Timeline zoom">
            {Math.round(zoom * 100)}%
          </span>
          <button className="mini" title="Zoom in (or pinch / ⌘ scroll)" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom * 1.5)}>
            +
          </button>
          <button className="mini fit" title="Fit the whole slide" disabled={zoom === 1} onClick={() => zoomTo(1)}>
            Fit
          </button>
        </div>
      </div>

      <div className="tl-body" ref={bodyRef}>
        <div className="tl-content" style={{ width: LABEL_W + trackW + 2 * PAD }}>
          <div className="tl-row tl-head">
            <div className="tl-label dim">Layers</div>
            <div className="tl-ruler" ref={rulerRef} onPointerDown={scrub} onPointerMove={scrubMove}>
              {!ctx?.container && slide.transition.type !== "cut" && (
                <div className="tl-transition" style={{ width: pct(Math.min(dur, slide.transition.durationMs)) }} title="Entry transition from the previous slide. It plays when you press play; while paused the slide is shown on its own.">
                  {TRANSITION_LABELS[slide.transition.type]}
                </div>
              )}
              {ticks.map(({ t, at, major, label }) => (
                <div key={at} className={`tick ${major ? "" : "minor"} ${(view.total - at) * pxPerMs < 28 ? "end" : ""}`} style={{ left: pct(t) }}>
                  {label && <span>{label}</span>}
                </div>
              ))}
              {hold ? phaseRuler(hold) : outroHandle}
              {/* On top of the phase handles, so grabbing the playhead always moves the playhead, from where it is. */}
              <div
                className="playhead"
                style={{ left: pct(playhead) }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  set({ playing: false, keyframeId: null });
                }}
                onPointerMove={scrubMove}
              />
            </div>
          </div>
          <div className="tl-rows">
            {rows.map((el) => {
              const separate = isSeparate(el);
              const tracks: TimelineTrack<SlideElement>[] = elementEditor(el.type).tracks?.(el, scopeAt(Date.now()), clock) ?? [];
              // Something to expand: property rows (keyed separately) and/or the element's own tracks.
              const expandable = separate || tracks.length > 0;
              const open = expandable && expanded.has(el.id);
              return (
                <div key={el.id} className="tl-group">
                  <div
                    className={`tl-row ${selection.includes(el.id) ? "selected" : ""} ${dragOver === el.id ? "drag-over" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(el.id);
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => {
                      setDragOver(null);
                      const id = e.dataTransfer.getData("text/element");
                      if (id && id !== el.id) reorder(id, el.id);
                    }}
                  >
                    <div className="tl-label" draggable onDragStart={(e) => e.dataTransfer.setData("text/element", el.id)} onClick={(e) => (e.shiftKey ? toggleSelected(el.id) : selectElement(el.id))}>
                      <button
                        className={`mini ${el.hidden ? "off" : ""}`}
                        title={el.hidden ? "Show" : "Hide"}
                        onClick={(e) => {
                          e.stopPropagation();
                          update((p) => {
                            const x = findEl(p, slide.id, el.id)!;
                            x.hidden = !x.hidden;
                          });
                        }}
                      >
                        <Icon name={el.hidden ? "eyeOff" : "eye"} size={13} />
                      </button>
                      <button
                        className={`mini ${el.locked ? "on" : "off"}`}
                        title={el.locked ? "Unlock" : "Lock on canvas"}
                        onClick={(e) => {
                          e.stopPropagation();
                          update((p) => {
                            const x = findEl(p, slide.id, el.id)!;
                            x.locked = !x.locked;
                          });
                        }}
                      >
                        <Icon name={el.locked ? "lock" : "unlock"} size={13} />
                      </button>
                      <ElementGlyph type={el.type} />
                      <span className="name" onDoubleClick={() => isContainer(el) && enter(el.id)}>
                        {el.name}
                      </span>
                      {isContainer(el) && (
                        <button
                          className="mini tl-enter"
                          title={el.type === "rotator" ? "Edit the item layout" : "Edit what's inside"}
                          onClick={(e) => {
                            e.stopPropagation();
                            enter(el.id);
                          }}
                        >
                          <Icon name="enter" size={12} />
                        </button>
                      )}
                      {expandable && (
                        <button
                          className={`mini tl-caret ${open ? "open" : ""}`}
                          title={open ? "Collapse" : separate ? `Show position, size, colour and opacity${tracks.length ? " and " + tracks.map((t) => t.label.toLowerCase()).join(", ") : ""}` : `Show ${tracks.map((t) => t.label.toLowerCase()).join(", ")}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpanded(el.id);
                          }}
                        >
                          <Icon name="chevron" size={12} />
                        </button>
                      )}
                    </div>
                    <div
                      className="tl-track"
                      onPointerDown={(e) => {
                        lead(el.id);
                        scrub(e);
                      }}
                      onPointerMove={scrubMove}
                    >
                      {separate ? (
                        ghostTrack(el, tracks)
                      ) : (
                        <>
                          {keyTrack(el, sortedKeyframes(timed(el).keyframes))}
                          {tracks.map((tr) => (
                            <div key={tr.id} className={`track-strip ch-${tr.id}`}>
                              {trackSummary(tr, "strip")}
                            </div>
                          ))}
                        </>
                      )}
                      {outroShade}
                      {holdBand}
                      <div className="playhead" style={{ left: pct(playhead) }} />
                    </div>
                  </div>
                  {open &&
                    separate &&
                    CHANNELS.map((c) => (
                      <div key={c} className={`tl-row tl-channel ch-${c} ${selection.includes(el.id) ? "selected" : ""}`}>
                        <div className="tl-label" onClick={(e) => (e.shiftKey ? toggleSelected(el.id) : selectElement(el.id))}>
                          <span className="ch-dot" />
                          <span className="name">{CHANNEL_LABELS[c]}</span>
                          <button
                            className="mini tl-key"
                            title={`Key ${CHANNEL_LABELS[c].toLowerCase()} at the playhead`}
                            onClick={(e) => {
                              e.stopPropagation();
                              update((p) => {
                                const x = findEl(p, slide.id, el.id);
                                if (x) set({ elementId: el.id, keyframeId: addKeyframe(x, playhead, p.fps, clock, c) });
                              });
                            }}
                          >
                            <Icon name="keyframe" size={9} />
                          </button>
                        </div>
                        <div
                          className="tl-track"
                          onPointerDown={(e) => {
                            lead(el.id);
                            scrub(e);
                          }}
                          onPointerMove={scrubMove}
                        >
                          {keyTrack(el, keysFor(timed(el), c), c)}
                          {outroShade}
                          {holdBand}
                          <div className="playhead" style={{ left: pct(playhead) }} />
                        </div>
                      </div>
                    ))}
                  {open && tracks.map((tr) => trackRow(el, tr))}
                </div>
              );
            })}
            {!rows.length && <div className="tl-empty dim">Add text, shapes, icons or images from the toolbar above the canvas.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
