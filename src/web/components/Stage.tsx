import { useCallback, useEffect, useRef, useState } from "react";
import { snapState, stateAt } from "../../shared/animate";
import { frameMsFor, renderFrame } from "../../shared/clip";
import { blackFrame, newFrame, renderSlide, settleSlide, type Frame, type View } from "../../shared/render";
import type { AnimState, Project, Slide } from "../../shared/types";
import { HEIGHT, WIDTH } from "../../shared/types";
import { paintFrame, paintPixels, type LedMode } from "../led";
import { isContainer } from "../../elements/tree";
import { editState, findEl, findSlide, resizeBox, type Handle } from "../model";
import { currentClock, currentContext, scopeAt, selectionOf, useEditContext, useSelection, useStore } from "../store";
import { Icon } from "./Icon";

/** The slide that plays before `slideId` in the active deck, for transition previews. */
export function previousInDeck(p: Project, slideId: string): Slide | null {
  if (p.systemSlides?.some((s) => s.id === slideId)) return null;
  const deck = p.decks.find((d) => d.id === p.activeDeckId);
  const items = deck?.items.filter((i) => i.enabled) ?? [];
  const idx = items.findIndex((i) => i.slideId === slideId);
  if (items.length < 2) return null;
  const prevItem = idx <= 0 ? items[items.length - 1] : items[idx - 1];
  return p.slides.find((s) => s.id === prevItem.slideId && s.id !== slideId) ?? null;
}

export function lastFrameOf(slide: Slide, fps: number): Frame {
  const scope = scopeAt(Date.now(), slide);
  const played = settleSlide(slide, scope);
  return renderSlide(played, played.durationSec * 1000 - frameMsFor(fps), scope);
}

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** How far around the panel (in LED pixels) off-screen content is drawn. */
const PASTEBOARD = 64;
const MIN_ZOOM = 2;
const MAX_ZOOM = 60;
/** The zoom readout's 100%: each LED 10 screen pixels, the panel 640×320. 1px per LED would be uselessly small. */
const PX_PER_LED_AT_100 = 10;

/** zoom = screen px per LED pixel; (panX, panY) = where the panel's top-left sits. */
interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}

interface Drag {
  kind: "move" | "resize" | "pan" | "marquee";
  elId?: string;
  /** Moving: every selected element and where it started. */
  starts?: { id: string; s: AnimState }[];
  /** Drawing a selection box: where it started (level pixels), and what was selected before. */
  from?: { x: number; y: number };
  base?: string[];
  handle?: Handle;
  lockAspect?: boolean;
  startX: number;
  startY: number;
  start?: AnimState;
  startCam?: Camera;
  key: string;
}

function fitCamera(w: number, h: number): Camera {
  const zoom = Math.max(MIN_ZOOM, Math.min(18, Math.floor(Math.min((w - 48) / WIDTH, (h - 48) / HEIGHT))));
  return { zoom, panX: Math.round((w - WIDTH * zoom) / 2), panY: Math.round((h - HEIGHT * zoom) / 2) };
}

export function Stage({ mode }: { mode: LedMode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cam, setCamState] = useState<Camera>({ zoom: 12, panX: 0, panY: 0 });
  const camRef = useRef(cam);
  const fittedRef = useRef(true);
  const sizeRef = useRef({ w: 0, h: 0 });
  const dragRef = useRef<Drag | null>(null);
  const [panning, setPanning] = useState(false);

  const slideId = useStore((s) => s.slideId);
  const elementId = useStore((s) => s.elementId);
  const selection = useSelection();
  // A selection box being drawn (Shift-drag on empty space), in level pixels.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const playhead = useStore((s) => s.playhead);
  const slide = useStore((s) => (s.project ? findSlide(s.project, s.slideId) : null));
  // The level being edited: the slide, or the children of an entered group or rotator.
  const ctx = useEditContext();
  const selected = ctx?.elements.find((e) => e.id === elementId) ?? null;

  const setCam = useCallback((c: Camera, fitted = false) => {
    camRef.current = c;
    fittedRef.current = fitted;
    setCamState(c);
  }, []);

  const fit = useCallback(() => setCam(fitCamera(sizeRef.current.w, sizeRef.current.h), true), [setCam]);

  /** Zoom by `factor`, keeping the canvas point (cx, cy) fixed on screen. */
  const zoomAt = useCallback(
    (factor: number, cx = sizeRef.current.w / 2, cy = sizeRef.current.h / 2) => {
      const c = camRef.current;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor));
      const k = zoom / c.zoom;
      setCam({ zoom, panX: cx - (cx - c.panX) * k, panY: cy - (cy - c.panY) * k });
    },
    [setCam],
  );

  // Size the canvas to the stage; keep the panel fitted until the user zooms or pans.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
      const c = canvasRef.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.round(el.clientWidth * dpr);
        c.height = Math.round(el.clientHeight * dpr);
      }
      if (fittedRef.current) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, slideId]);

  // Trackpad pinch and ⌘/Ctrl+wheel zoom; plain wheel pans. Needs a non-passive listener.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        const c = camRef.current;
        setCam({ ...c, panX: c.panX - e.deltaX, panY: c.panY - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, setCam, slideId]);

  // ⌘0 fit, ⌘= / ⌘- zoom (instead of zooming the whole page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.target instanceof Element && e.target.closest("input, textarea, select"))) return;
      if (e.key === "0") fit();
      else if (e.key === "=" || e.key === "+") zoomAt(1.25);
      else if (e.key === "-") zoomAt(0.8);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, zoomAt]);

  // Render loop: reads the latest store state every animation frame.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const panelOut = newFrame();
    const scratch = newFrame();
    let board: { view: View; frame: Frame } | null = null;
    let prevCache: { key: unknown; frame: Frame | null } = { key: null, frame: null };
    const tick = (now: number) => {
      const st = useStore.getState();
      const p = st.project;
      const edited = p && findSlide(p, st.slideId);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const level = p && edited ? currentContext() : null;
      // Fitted to its content, the slide plays as long as that needs right now.
      const s = edited && level && edited.fit ? { ...edited, durationSec: level.slideMs / 1000 } : edited;
      if (p && s && ctx && canvas && level) {
        // The playhead is this level's time (an item's, inside a rotator); drawing needs slide time.
        let local = st.playhead;
        if (st.playing) {
          local = (local + (now - last)) % level.duration;
          st.set({ playhead: local });
        }
        const t = level.toSlideTime(local);
        const { zoom, panX, panY } = camRef.current;
        const { w: W, h: H } = sizeRef.current;
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#0b0d10";
        ctx.fillRect(0, 0, W, H);
        const scope = scopeAt(Date.now());

        // Off-panel content, dimmed, for the visible part of the pasteboard.
        const x0 = Math.max(-PASTEBOARD, Math.floor(-panX / zoom));
        const y0 = Math.max(-PASTEBOARD, Math.floor(-panY / zoom));
        const x1 = Math.min(WIDTH + PASTEBOARD, Math.ceil((W - panX) / zoom));
        const y1 = Math.min(HEIGHT + PASTEBOARD, Math.ceil((H - panY) / zoom));
        if (x1 > x0 && y1 > y0) {
          const view = { x0, y0, w: x1 - x0, h: y1 - y0 };
          if (!board || board.view.w !== view.w || board.view.h !== view.h) board = { view, frame: newFrame(view) };
          board.view = view;
          renderSlide(s, t, scope, board.frame, view);
          ctx.globalAlpha = 0.35;
          paintPixels(ctx, board.frame, view.w, view.h, zoom, panX + x0 * zoom, panY + y0 * zoom);
          ctx.globalAlpha = 1;
        }

        // The panel itself, with a bezel.
        let prev: Frame | null = null;
        // Paused, show the slide itself so it can be edited; play to see the entry transition.
        if (st.playing && !level.levels.length && s.transition.type !== "cut" && t < s.transition.durationMs) {
          const before = previousInDeck(p, s.id);
          const key = before ?? "black";
          if (prevCache.key !== key) prevCache = { key, frame: before ? lastFrameOf(before, p.fps) : blackFrame() };
          prev = prevCache.frame;
        }
        renderFrame(s, t, scope, prev, panelOut, scratch);
        const bezel = Math.max(4, zoom * 0.8);
        ctx.fillStyle = "#050607";
        ctx.fillRect(panX - bezel, panY - bezel, WIDTH * zoom + bezel * 2, HEIGHT * zoom + bezel * 2);
        ctx.strokeStyle = "#2a3039";
        ctx.lineWidth = 1;
        ctx.strokeRect(panX - bezel - 0.5, panY - bezel - 0.5, WIDTH * zoom + bezel * 2 + 1, HEIGHT * zoom + bezel * 2 + 1);
        paintFrame(ctx, panelOut, zoom, mode, panX, panY);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  const toPixel = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const c = camRef.current;
    return { x: Math.floor((e.clientX - r.left - c.panX) / c.zoom), y: Math.floor((e.clientY - r.top - c.panY) / c.zoom) };
  };

  const startPan = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, startCam: camRef.current, key: "" };
    setPanning(true);
  };

  const onPointerDown = (e: React.PointerEvent, handle?: Handle) => {
    if (!slide || !ctx) return;
    // Middle button always pans.
    if (e.button === 1) {
      e.preventDefault();
      return startPan(e);
    }
    if (e.button !== 0) return;
    const st = useStore.getState();
    // Positions at this level are relative to its origin (the entered container's corner).
    const o = ctx.origin(st.playhead);
    const abs = toPixel(e);
    const pt = { x: abs.x - o.x, y: abs.y - o.y };
    let target = handle ? selected : null;
    if (!handle) {
      for (let i = ctx.elements.length - 1; i >= 0; i--) {
        const el = ctx.elements[i];
        if (el.hidden || el.locked) continue;
        const s = snapState(stateAt(el, st.playhead, ctx.duration));
        if (pt.x >= s.x && pt.x < s.x + Math.max(1, s.w) && pt.y >= s.y && pt.y < s.y + Math.max(1, s.h)) {
          target = el;
          break;
        }
      }
    }
    e.stopPropagation();
    if (!target) {
      // Empty space: Shift-drag draws a selection box; otherwise deselect, and dragging pans the view.
      if (e.shiftKey) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        dragRef.current = { kind: "marquee", from: pt, base: selectionOf(st), startX: e.clientX, startY: e.clientY, key: "" };
        setMarquee({ ...pt, w: 0, h: 0 });
        return;
      }
      st.selectElement(null);
      return startPan(e);
    }
    let ids = selectionOf(st);
    if (handle) {
      // Resizing is one element at a time.
    } else if (e.shiftKey) {
      // Shift-click adds it to the selection, or takes it out (and then there's nothing to drag).
      st.toggleSelected(target.id);
      ids = selectionOf(useStore.getState());
      if (!ids.includes(target.id)) return;
    } else if (ids.includes(target.id)) {
      // Part of the selection: it leads, and the whole selection moves.
      st.set({ elementId: target.id, selected: ids, keyframeId: null });
    } else {
      st.selectElement(target.id);
      ids = [target.id];
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const starts = ctx.elements.filter((el) => ids.includes(el.id) && !el.locked).map((el) => ({ id: el.id, s: snapState(stateAt(el, st.playhead, ctx.duration)) }));
    dragRef.current = {
      kind: handle ? "resize" : "move",
      elId: target.id,
      handle,
      starts,
      lockAspect: !!target.lockAspect,
      startX: e.clientX,
      startY: e.clientY,
      start: snapState(stateAt(target, st.playhead, ctx.duration)),
      key: `drag-${Date.now()}`,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      const c = d.startCam!;
      setCam({ ...c, panX: c.panX + e.clientX - d.startX, panY: c.panY + e.clientY - d.startY });
      return;
    }
    const st = useStore.getState();
    if (d.kind === "marquee") {
      // Everything the box touches, added to what was selected before.
      const level = currentContext();
      if (!level) return;
      const o = level.origin(st.playhead);
      const abs = toPixel(e);
      const [x0, y0, x1, y1] = [Math.min(d.from!.x, abs.x - o.x), Math.min(d.from!.y, abs.y - o.y), Math.max(d.from!.x, abs.x - o.x), Math.max(d.from!.y, abs.y - o.y)];
      setMarquee({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      const hits = level.elements
        .filter((el) => !el.hidden && !el.locked)
        .filter((el) => {
          const s = snapState(stateAt(el, st.playhead, level.duration));
          return s.x <= x1 && s.x + Math.max(1, s.w) > x0 && s.y <= y1 && s.y + Math.max(1, s.h) > y0;
        })
        .map((el) => el.id);
      st.selectMany([...new Set([...d.base!, ...hits])]);
      return;
    }
    const zoom = camRef.current.zoom;
    const dx = Math.round((e.clientX - d.startX) / zoom);
    const dy = Math.round((e.clientY - d.startY) / zoom);
    let kfId: string | null = null;
    st.update((p) => {
      if (d.kind === "move") {
        for (const { id, s } of d.starts ?? []) {
          const el = findEl(p, st.slideId, id);
          const k = el && editState(el, { x: s.x + dx, y: s.y + dy }, st.playhead, p.fps, currentClock());
          if (id === d.elId) kfId = k ?? null;
        }
        return;
      }
      // Shift flips the element's aspect lock for this drag; Option/Alt resizes from the centre.
      const el = findEl(p, st.slideId, d.elId ?? null);
      if (el) kfId = editState(el, resizeBox(d.start!, d.handle!, dx, dy, d.lockAspect !== e.shiftKey, e.altKey), st.playhead, p.fps, currentClock());
    }, d.key);
    if (kfId) st.set({ keyframeId: kfId });
  };

  const onPointerUp = () => {
    dragRef.current = null;
    setPanning(false);
    setMarquee(null);
  };

  const o = ctx?.origin(playhead) ?? { x: 0, y: 0 };
  const { zoom, panX, panY } = cam;
  const local = selected && !selected.hidden && ctx ? snapState(stateAt(selected, playhead, ctx.duration)) : null;
  const box = local ? { ...local, x: local.x + o.x, y: local.y + o.y } : null;
  // With more than one selected: a box for each, and one around them all; resize handles only for one.
  const many = selection.length > 1 && ctx ? ctx.elements.filter((el) => selection.includes(el.id) && !el.hidden) : [];
  const boxes = many.map((el) => ({ el, s: snapState(stateAt(el, playhead, ctx!.duration)) }));
  const union = boxes.length
    ? (() => {
        const x = Math.min(...boxes.map((b) => b.s.x));
        const y = Math.min(...boxes.map((b) => b.s.y));
        return { x: x + o.x, y: y + o.y, w: Math.max(...boxes.map((b) => b.s.x + b.s.w)) - x, h: Math.max(...boxes.map((b) => b.s.y + b.s.h)) - y };
      })()
    : null;
  const screen = (b: { x: number; y: number; w: number; h: number }) => ({ left: panX + b.x * zoom, top: panY + b.y * zoom, width: Math.max(1, b.w) * zoom, height: Math.max(1, b.h) * zoom });
  const { enter, exitTo, set } = useStore.getState();
  const rotatorLevel = ctx?.levels.at(-1)?.kind === "rotator" ? ctx.levels.at(-1)! : null;

  return (
    <div className={`stage ${panning ? "panning" : ""}`} ref={wrapRef}>
      {slideId ? (
        <>
          <canvas ref={canvasRef} className="stage-canvas" />
          <div
            className="stage-overlay"
            onPointerDown={(e) => onPointerDown(e)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onAuxClick={(e) => e.preventDefault()}
            onDoubleClick={() => {
              // A group or rotator opens for editing its contents; anything else focuses its main field.
              if (selected && isContainer(selected)) enter(selected.id);
              else if (selected) window.dispatchEvent(new Event("morsel:edit-element"));
            }}
          >
            {ctx?.container && (
              // The entered container's box, with everything outside it dimmed.
              <div className="level-frame" style={{ left: panX + o.x * zoom, top: panY + o.y * zoom, width: Math.max(1, ctx.size.w) * zoom, height: Math.max(1, ctx.size.h) * zoom }} />
            )}
            {boxes.map(({ el, s: b }) => (
              <div key={el.id} className={`sel-box ${el.id === elementId ? "lead" : "member"} ${el.locked ? "locked" : ""}`} style={screen({ ...b, x: b.x + o.x, y: b.y + o.y })} />
            ))}
            {union && <div className="sel-union" style={screen(union)} />}
            {marquee && <div className="marquee" style={screen({ ...marquee, x: marquee.x + o.x, y: marquee.y + o.y })} />}
            {box && !many.length && (
              <div
                className={`sel-box ${selected?.locked ? "locked" : ""}`}
                style={{ left: panX + box.x * zoom, top: panY + box.y * zoom, width: Math.max(1, box.w) * zoom, height: Math.max(1, box.h) * zoom }}
              >
                {!selected?.locked &&
                  HANDLES.map((h) => (
                    <div
                      key={h}
                      className={`handle h-${h}`}
                      onPointerDown={(e) => onPointerDown(e, h)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                    />
                  ))}
              </div>
            )}
          </div>
          {ctx && ctx.levels.length > 0 && (
            <div className="level-bar" onPointerDown={(e) => e.stopPropagation()}>
              <button className="crumb" title="Back to the slide (Esc)" onClick={() => exitTo(0)}>
                {ctx.slide.name}
              </button>
              {ctx.levels.map((l, i) => (
                <span key={l.container.id} className="crumb-part">
                  <Icon name="chevron" size={10} />
                  <button className={`crumb ${i === ctx.levels.length - 1 ? "on" : ""}`} onClick={() => exitTo(i + 1)} disabled={i === ctx.levels.length - 1}>
                    {l.container.name}
                  </button>
                </span>
              ))}
              {rotatorLevel && (rotatorLevel.items ?? 0) > 0 && (
                <span className="item-stepper" title="Which item to lay out against">
                  <button className="mini" disabled={(rotatorLevel.item ?? 0) <= 0} onClick={() => set({ previewItem: (rotatorLevel.item ?? 0) - 1, playhead: 0 })}>
                    ‹
                  </button>
                  <span className="mono small">
                    Item {(rotatorLevel.item ?? 0) + 1} of {rotatorLevel.items}
                  </span>
                  <button className="mini" disabled={(rotatorLevel.item ?? 0) >= (rotatorLevel.items ?? 1) - 1} onClick={() => set({ previewItem: (rotatorLevel.item ?? 0) + 1, playhead: 0 })}>
                    ›
                  </button>
                </span>
              )}
              <button className="btn small" onClick={() => exitTo(ctx.levels.length - 1)}>
                Done
              </button>
            </div>
          )}
          <div className="zoom-bar" onPointerDown={(e) => e.stopPropagation()}>
            <button className="mini" title="Zoom out (⌘−)" onClick={() => zoomAt(0.8)}>
              −
            </button>
            <span className="mono small" title={`${Math.round(zoom * 10) / 10} screen pixels per LED (100% shows the panel at 640×320)`}>
              {Math.round((zoom / PX_PER_LED_AT_100) * 100)}%
            </span>
            <button className="mini" title="Zoom in (⌘=)" onClick={() => zoomAt(1.25)}>
              +
            </button>
            <button className="mini fit" title="Fit the panel (⌘0)" onClick={fit}>
              Fit
            </button>
          </div>
          <div className="stage-hint dim small">Scroll to pan · pinch or ⌘ scroll to zoom · drag empty space to pan · Shift-click to select more</div>
        </>
      ) : (
        <div className="empty">Pick or create a slide</div>
      )}
    </div>
  );
}
