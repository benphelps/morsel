import { useEffect, useState } from "react";
import { confirmDialog } from "./Dialogs";
import { createElement, createSlide } from "../../shared/defaults";
import { createSystemSlide, SYSTEM_KINDS } from "../../shared/templates";
import { uid } from "../../shared/id";
import { ELEMENT_GROUPS, ELEMENT_TYPES, elementDef, type ElementType } from "../../elements";
import { elementEditor } from "../../elements/editors";
import type { LedMode } from "../led";
import { addKeyframe, contextList, duplicateElement, duplicateSlide, editState, findEl, findElement, findSlide, groupElements, listOf, removeKeyframe, shiftElement, ungroup } from "../model";
import { currentClock, currentContext, scopeAt, selectionOf, slideLength, useStore } from "../store";
import { Inspector } from "./Inspector";
import { Stage } from "./Stage";
import { Thumb } from "./Thumb";
import { Timeline } from "./Timeline";
import { snapState, stateAt } from "../../shared/animate";
import { Icon, PathIcon } from "./Icon";

export function EditorView({ mode: listMode = "library" }: { mode?: "library" | "system" }) {
  const [mode, setMode] = useState<LedMode>("led");
  const slideId = useStore((s) => s.slideId);
  const { update, set } = useStore.getState();

  const addElement = (type: ElementType, extra = {}) => {
    const el = createElement(type, extra, scopeAt(Date.now()));
    // Into the level being edited: the slide, or the entered group or rotator.
    update((p) => {
      contextList(p, slideId, useStore.getState().inside)?.push(el);
    });
    set({ elementId: el.id, keyframeId: null });
  };

  useKeyboard();

  return (
    <div className="editor">
      {listMode === "system" ? <SystemSlideList /> : <SlideList />}
      <div className="editor-main">
        <div className="toolbar">
          {ELEMENT_GROUPS.map((g) => (
            <div key={g.id} className="tool-group" role="group" aria-label={g.label}>
              {ELEMENT_TYPES.filter((type) => elementDef(type).group === g.id).map((type) => {
                const { AddButton } = elementEditor(type);
                if (AddButton) return <AddButton key={type} add={(extra: object) => addElement(type, extra)} disabled={!slideId} />;
                const def = elementDef(type);
                return (
                  <button key={type} className="tool" disabled={!slideId} onClick={() => addElement(type)} title={`Add ${def.label.toLowerCase()}`}>
                    <PathIcon d={def.icon} className="tool-glyph" />
                    {def.label}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="spacer" />
          <div className="segmented">
            <button className={mode === "led" ? "on" : ""} onClick={() => setMode("led")}>
              LED
            </button>
            <button className={mode === "pixel" ? "on" : ""} onClick={() => setMode("pixel")}>
              Pixels
            </button>
          </div>
        </div>
        <Stage mode={mode} />
        <Timeline />
      </div>
      <Inspector />
    </div>
  );
}

/** The notification templates: fixed set, edit or reset only. */
function SystemSlideList() {
  const slides = useStore((s) => s.project?.systemSlides ?? []);
  useStore((s) => s.sourceStatus); // fitted lengths follow the data
  const slideId = useStore((s) => s.slideId);
  const { update, selectSlide } = useStore.getState();
  return (
    <aside className="slide-list">
      <div className="panel-head">
        <span>System slides</span>
      </div>
      <div className="slide-items">
        {SYSTEM_KINDS.map(({ kind, name }) => {
          const s = slides.find((x) => x.system === kind);
          if (!s) return null;
          return (
            <div key={kind} className={`slide-item ${s.id === slideId ? "on" : ""}`} onClick={() => selectSlide(s.id)}>
              <Thumb slide={s} zoom={3} />
              <div className="slide-meta">
                <span className="trunc">{name}</span>
                <span className="dim small mono">{slideLength(s)}</span>
              </div>
              {s.id === slideId && (
                <div className="slide-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="mini"
                    title="Reset to the default design"
                    onClick={async () => {
                      const ok = await confirmDialog({ title: `Reset “${name}”?`, message: "It goes back to its default design, and your changes to it are lost.", confirmLabel: "Reset", danger: true });
                      if (!ok) return;
                      update((p) => {
                        const i = p.systemSlides?.findIndex((x) => x.system === kind) ?? -1;
                        if (i >= 0) p.systemSlides![i] = createSystemSlide(kind);
                      });
                      useStore.getState().selectElement(null);
                    }}
                  >
                    <Icon name="reset" size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function SlideList() {
  const slides = useStore((s) => s.project?.slides ?? []);
  useStore((s) => s.sourceStatus); // fitted lengths follow the data
  const project = useStore((s) => s.project);
  const slideId = useStore((s) => s.slideId);
  const { update, selectSlide } = useStore.getState();
  const deck = project?.decks.find((d) => d.id === project.activeDeckId);

  return (
    <aside className="slide-list">
      <div className="panel-head">
        <span>Slides</span>
        <button
          className="btn small primary"
          onClick={() => {
            const s = createSlide(`Slide ${slides.length + 1}`);
            update((p) => {
              p.slides.push(s);
              p.decks.find((d) => d.id === p.activeDeckId)?.items.push({ id: uid("di_"), slideId: s.id, enabled: true });
            });
            selectSlide(s.id);
          }}
        >
          + New
        </button>
      </div>
      <div className="slide-items">
        {slides.map((s) => (
          <div key={s.id} className={`slide-item ${s.id === slideId ? "on" : ""}`} onClick={() => selectSlide(s.id)}>
            <Thumb slide={s} zoom={3} />
            <div className="slide-meta">
              <span className="trunc">{s.name}</span>
              <span className="dim small mono">
                {slideLength(s)}{deck?.items.some((i) => i.slideId === s.id) ? "" : " · not in deck"}
              </span>
            </div>
            {s.id === slideId && (
              <div className="slide-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="mini"
                  title="Duplicate slide"
                  onClick={() => {
                    const copy = duplicateSlide(s);
                    update((p) => {
                      p.slides.splice(p.slides.findIndex((x) => x.id === s.id) + 1, 0, copy);
                    });
                    selectSlide(copy.id);
                  }}
                >
                  <Icon name="duplicate" size={13} />
                </button>
                <button
                  className="mini"
                  title="Delete slide"
                  onClick={async () => {
                    if (!(await confirmDialog({ title: `Delete “${s.name}”?`, message: "It will be removed from every deck.", confirmLabel: "Delete slide", danger: true }))) return;
                    update((p) => {
                      p.slides = p.slides.filter((x) => x.id !== s.id);
                      p.decks.forEach((d) => (d.items = d.items.filter((i) => i.slideId !== s.id)));
                    });
                    selectSlide(slides.find((x) => x.id !== s.id)?.id ?? null);
                  }}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

function useKeyboard() {
  useEffect(() => {
    /** The selected elements, wherever they are in the tree. */
    const selectedEls = () => {
      const st = useStore.getState();
      const slide = st.project && findSlide(st.project, st.slideId);
      return selectionOf(st)
        .map((id) => findElement(slide, id))
        .filter((el): el is NonNullable<typeof el> => !!el);
    };
    const onDuplicate = () => {
      const st = useStore.getState();
      const els = selectedEls();
      if (!els.length) return;
      const copies = els.map((el) => {
        const copy = duplicateElement(el);
        shiftElement(copy, 2, 2);
        return { el, copy };
      });
      st.update((p) => {
        for (const { el, copy } of copies) {
          const list = listOf(p, st.slideId, el.id);
          list?.splice(list.findIndex((e) => e.id === el.id) + 1, 0, copy);
        }
      });
      st.selectMany(copies.map((c) => c.copy.id));
    };
    const onDelete = () => {
      const st = useStore.getState();
      const ids = selectionOf(st);
      if (!ids.length) return;
      st.update((p) => {
        for (const id of ids) {
          const list = listOf(p, st.slideId, id);
          if (list) list.splice(list.findIndex((e) => e.id === id), 1);
        }
      });
      st.set({ elementId: null, keyframeId: null });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const slide = st.project && findSlide(st.project, st.slideId);
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        st.redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        onDuplicate();
      } else if (e.key === " ") {
        e.preventDefault();
        st.set({ playing: !st.playing });
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        window.dispatchEvent(new Event(e.shiftKey ? "morsel:ungroup" : "morsel:group"));
      } else if (mod && e.key.toLowerCase() === "a") {
        // Everything at this level (inside the entered group or rotator, if any).
        e.preventDefault();
        const ctx = currentContext();
        if (ctx) st.selectMany(ctx.elements.map((el) => el.id));
      } else if (e.key === "Escape") {
        // Deselect first; with nothing selected, step out of the entered group or rotator.
        if (st.elementId) st.selectElement(null);
        else if (st.inside.length) st.exitTo(st.inside.length - 1);
      } else if (e.key === "Enter" && st.elementId) {
        e.preventDefault();
        window.dispatchEvent(new Event("morsel:edit-element"));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (st.keyframeId && st.elementId) {
          st.update((p) => {
            const el = findEl(p, st.slideId, st.elementId);
            if (el) removeKeyframe(el, st.keyframeId!);
          });
          st.set({ keyframeId: null });
        } else onDelete();
      } else if (e.key.toLowerCase() === "k" && st.elementId) {
        // Keys every selected element; the leading one's key is the one selected.
        const ids = selectionOf(st);
        let kf: string | null = null;
        st.update((p) => {
          for (const id of ids) {
            const el = findEl(p, st.slideId, id);
            const k = el && addKeyframe(el, st.playhead, p.fps, currentClock());
            if (id === st.elementId) kf = k ?? null;
          }
        });
        st.set({ keyframeId: kf, selected: ids });
      } else if ((e.key === "," || e.key === ".") && slide) {
        const f = Math.round(1000 / st.project!.fps);
        const dur = currentContext()?.duration ?? slide.durationSec * 1000;
        st.set({ playing: false, playhead: Math.max(0, Math.min(dur, st.playhead + (e.key === "." ? f : -f))) });
      } else if (e.key.startsWith("Arrow") && st.elementId && slide) {
        e.preventDefault();
        const step = e.shiftKey ? 4 : 1;
        const els = selectedEls().filter((el) => !el.locked);
        if (!els.length) return;
        const clock = currentClock();
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
        let kf: string | null = null;
        st.update((p) => {
          for (const el of els) {
            const s = snapState(stateAt(el, st.playhead, clock.end));
            const x = findEl(p, st.slideId, el.id);
            const k = x && editState(x, { x: s.x + d[0], y: s.y + d[1] }, st.playhead, p.fps, clock);
            if (el.id === st.elementId) kf = k ?? null;
          }
        }, `nudge-${els.map((el) => el.id).join(",")}`);
        if (kf) st.set({ keyframeId: kf, selected: selectionOf(st) });
      }
    };
    // ⌘G: wrap the selection in a group, in place. ⇧⌘G: take a selected group apart.
    const onGroup = () => {
      const st = useStore.getState();
      if (!st.elementId) return;
      const ids = selectionOf(st);
      let group: string | null = null;
      st.update((p) => {
        const list = listOf(p, st.slideId, st.elementId);
        if (list) group = groupElements(list, ids, st.playhead, currentClock().end)?.id ?? null;
      });
      if (group) st.set({ elementId: group, keyframeId: null });
    };
    const onUngroup = () => {
      const st = useStore.getState();
      const slide = st.project && findSlide(st.project, st.slideId);
      if (findElement(slide, st.elementId)?.type !== "group") return;
      st.update((p) => {
        const list = listOf(p, st.slideId, st.elementId);
        if (list) ungroup(list, st.elementId!, st.playhead, currentClock().end);
      });
      st.set({ elementId: null, keyframeId: null });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("morsel:duplicate", onDuplicate);
    window.addEventListener("morsel:delete", onDelete);
    window.addEventListener("morsel:group", onGroup);
    window.addEventListener("morsel:ungroup", onUngroup);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("morsel:duplicate", onDuplicate);
      window.removeEventListener("morsel:delete", onDelete);
      window.removeEventListener("morsel:group", onGroup);
      window.removeEventListener("morsel:ungroup", onUngroup);
    };
  }, []);
}
