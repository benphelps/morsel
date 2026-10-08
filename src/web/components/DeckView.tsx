import { useEffect, useRef, useState } from "react";
import { confirmDialog, promptDialog } from "./Dialogs";
import { frameMsFor, renderFrame } from "../../shared/clip";
import { createDeck } from "../../shared/defaults";
import { uid } from "../../shared/id";
import { newFrame, renderSlide, settleSlide, type Frame } from "../../shared/render";
import { TRANSITION_LABELS } from "../../shared/transitions";
import type { Slide } from "../../shared/types";
import { HEIGHT, WIDTH } from "../../shared/types";
import { api } from "../api";
import { paintFrame } from "../led";
import { conditionHolds } from "../../shared/bindings";
import { liveScopeAt, scopeAt, slideLength, useStore } from "../store";
import { Thumb } from "./Thumb";
import { Icon } from "./Icon";

export function DeckView() {
  const project = useStore((s) => s.project!);
  useStore((s) => s.sourceStatus); // fitted lengths follow the data
  const { update, set, selectSlide } = useStore.getState();
  const [deckId, setDeckId] = useState(project.activeDeckId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [addId, setAddId] = useState("");
  const deck = project.decks.find((d) => d.id === deckId) ?? project.decks[0];
  if (!deck) return null;

  const slideOf = (id: string) => project.slides.find((s) => s.id === id);
  // "Only when" conditions use real data, exactly as the device decides.
  const live = liveScopeAt(Date.now());
  const active = (i: (typeof deck.items)[number]) => i.enabled && conditionHolds(i.showIf, live);
  // As they'll play: slides fitted to their content take as long as that needs right now.
  const enabled = deck.items
    .filter(active)
    .map((i) => slideOf(i.slideId))
    .filter((s): s is Slide => !!s)
    .map((s) => settleSlide(s, scopeAt(Date.now(), s)));
  const total = enabled.reduce((a, s) => a + s.durationSec, 0);
  const withDeck = (fn: (d: typeof deck) => void) =>
    update((p) => {
      const d = p.decks.find((x) => x.id === deck.id);
      if (d) fn(d);
    });

  return (
    <div className="deck-view">
      <div className="deck-list">
        <div className="deck-head">
          <select value={deck.id} onChange={(e) => setDeckId(e.target.value)}>
            {project.decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.id === project.activeDeckId ? " (on device)" : ""}
              </option>
            ))}
          </select>
          <button
            className="btn small"
            onClick={async () => {
              const name = await promptDialog({ title: "Rename deck", value: deck.name, confirmLabel: "Rename" });
              if (name) withDeck((d) => (d.name = name));
            }}
          >
            Rename
          </button>
          <button
            className="btn small"
            onClick={() => {
              const d = createDeck(`Deck ${project.decks.length + 1}`);
              update((p) => {
                p.decks.push(d);
              });
              setDeckId(d.id);
            }}
          >
            + New deck
          </button>
          {project.decks.length > 1 && (
            <button
              className="btn small danger"
              onClick={async () => {
                if (!(await confirmDialog({ title: `Delete deck “${deck.name}”?`, message: "Its slides stay in the library.", confirmLabel: "Delete deck", danger: true }))) return;
                update((p) => {
                  p.decks = p.decks.filter((d) => d.id !== deck.id);
                  if (p.activeDeckId === deck.id) p.activeDeckId = p.decks[0].id;
                });
                setDeckId(project.decks.find((d) => d.id !== deck.id)!.id);
              }}
            >
              Delete
            </button>
          )}
          <div className="spacer" />
          {deck.id === project.activeDeckId ? (
            <span className="pill live">
              <span className="status-dot" />
              Playing on device
            </span>
          ) : (
            <button className="btn primary small" onClick={() => update((p) => void (p.activeDeckId = deck.id))}>
              Play this deck on device
            </button>
          )}
        </div>

        <div className="deck-summary dim">
          {enabled.length} of {deck.items.length} slides playing now · loops every <span className="mono">{Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")}</span>
        </div>

        <ol className="deck-items">
          {deck.items.map((item, idx) => {
            const s = slideOf(item.slideId);
            if (!s) return null;
            return (
              <li
                key={item.id}
                className={`deck-item ${item.enabled ? "" : "disabled"} ${dragId === item.id ? "dragging" : ""}`}
                draggable
                onDragStart={() => setDragId(item.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragId || dragId === item.id) return;
                  withDeck((d) => {
                    const from = d.items.findIndex((i) => i.id === dragId);
                    const [moved] = d.items.splice(from, 1);
                    d.items.splice(idx, 0, moved);
                  });
                }}
              >
                <span className="grip" title="Drag to reorder">
                  <Icon name="grip" />
                </span>
                <span className="idx mono dim">{idx + 1}</span>
                <Thumb slide={s} zoom={3} />
                <div className="deck-meta">
                  <b>{s.name}</b>
                  <span className="dim small">
                    <span className="mono">{slideLength(s)}</span> · enters with {TRANSITION_LABELS[s.transition.type].toLowerCase()}
                  </span>
                  <div className="cond-row">
                    <input
                      className="cond-input mono"
                      value={item.showIf ?? ""}
                      placeholder="Only when… e.g. {{calendar.hasEvents}}"
                      title="Play this slide only while the binding has a value; start with ! for when it's empty"
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      onChange={(e) => withDeck((d) => (d.items.find((i) => i.id === item.id)!.showIf = e.target.value))}
                    />
                    {item.enabled && item.showIf?.trim() && (
                      <span className={`cond-state ${conditionHolds(item.showIf, live) ? "on" : "off"}`}>{conditionHolds(item.showIf, live) ? "playing" : "skipped now"}</span>
                    )}
                  </div>
                </div>
                <label className="switch" title={item.enabled ? "Skip this slide" : "Include this slide"}>
                  <input type="checkbox" checked={item.enabled} onChange={(e) => withDeck((d) => (d.items.find((i) => i.id === item.id)!.enabled = e.target.checked))} />
                  <span />
                </label>
                <button
                  className="btn small"
                  onClick={() => {
                    selectSlide(s.id);
                    set({ view: "editor" });
                  }}
                >
                  Edit
                </button>
                <button className="btn small" title="Show this slide on the device now" onClick={() => api.showOnDevice(s.id)}>
                  <Icon name="play" size={11} /> Device
                </button>
                <button className="mini" title="Remove from deck" onClick={() => withDeck((d) => (d.items = d.items.filter((i) => i.id !== item.id)))}>
                  <Icon name="close" size={13} />
                </button>
              </li>
            );
          })}
        </ol>

        <div className="deck-add">
          <select value={addId} onChange={(e) => setAddId(e.target.value)}>
            <option value="">Add a slide from the library…</option>
            {project.slides.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {deck.items.some((i) => i.slideId === s.id) ? " (already in deck)" : ""}
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={!addId}
            onClick={() => {
              withDeck((d) => d.items.push({ id: uid("di_"), slideId: addId, enabled: true }));
              setAddId("");
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="deck-preview">
        <DeckPlayer slides={enabled} fps={project.fps} />
      </div>
    </div>
  );
}

/** Plays a list of slides in order, with transitions, like the device will. */
function DeckPlayer({ slides, fps }: { slides: Slide[]; fps: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [label, setLabel] = useState("");
  const [progress, setProgress] = useState(0);
  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const zoom = 9;

  useEffect(() => {
    let raf = 0;
    let idx = 0;
    let t = 0;
    let last = performance.now();
    let prev: Frame | null = null;
    const out = newFrame();
    const scratch = newFrame();
    // Showings per slide, like the device keeps, so rotators showing a few items each time move on.
    const plays = new Map<string, number>();
    let shown: Slide | null = null;
    const scopeFor = (s: Slide) => ({ ...scopeAt(Date.now(), s), $play: plays.get(s.id) ?? 0 });
    const tick = (now: number) => {
      const list = slidesRef.current;
      const ctx = ref.current?.getContext("2d");
      if (ctx && list.length) {
        if (idx >= list.length) idx = 0;
        // Settled as it starts: a fitted slide's length can differ from one showing to the next.
        if (!shown || shown.id !== list[idx].id) shown = settleSlide(list[idx], scopeFor(list[idx]));
        let s = shown;
        t += now - last;
        if (t >= s.durationSec * 1000) {
          prev = renderSlide(s, s.durationSec * 1000 - frameMsFor(fps), scopeFor(s));
          plays.set(s.id, (plays.get(s.id) ?? 0) + 1);
          idx = (idx + 1) % list.length;
          t = 0;
          s = shown = settleSlide(list[idx], scopeFor(list[idx]));
        }
        renderFrame(s, t, scopeFor(s), prev, out, scratch);
        paintFrame(ctx, out, zoom, "led");
        setLabel(`${idx + 1}/${list.length} · ${s.name}`);
        setProgress(t / (s.durationSec * 1000));
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fps]);

  return (
    <div className="player">
      <div className="player-title dim">Deck preview</div>
      <canvas ref={ref} width={WIDTH * zoom} height={HEIGHT * zoom} className="player-canvas" />
      <div className="player-bar">
        <div style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="dim small">{slides.length ? label : "Turn on at least one slide to preview the deck."}</div>
    </div>
  );
}
