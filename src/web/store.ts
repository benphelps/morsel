import { produce } from "immer";
import { useMemo } from "react";
import { create } from "zustand";
import { buildScope } from "../shared/live";
import type { Scope } from "../shared/bindings";
import { sampleScope } from "../shared/templates";
import type { DndState, PluginInfo, Project, Slide, SourceStatus } from "../shared/types";
import type { Clock } from "../shared/animate";
import { fittedSec } from "../shared/render";
import { editContext, type EditContext } from "./context";
import { findSlide } from "./model";
import { api, CLIENT_ID } from "./api";
import { merge3 } from "./merge";

export type View = "editor" | "system" | "deck" | "data" | "device";

interface State {
  project: Project | null;
  plugins: PluginInfo[];
  sourceStatus: Record<string, SourceStatus>;
  /** Do Not Disturb, kept current by the server's event stream. */
  dnd: DndState | null;
  /** Bumped when the device moves on to another clip, so its status is fetched at once. */
  deviceTick: number;
  view: View;
  slideId: string | null;
  /** Containers entered on the current slide (double-click a group or rotator), outermost first. */
  inside: string[];
  /** Inside a rotator: which item to lay out against. */
  previewItem: number;
  /** The selected element that the inspector and timeline tools act on: the last one picked. */
  elementId: string | null;
  /**
   * Everything selected at the current level, elementId among them. Setting
   * elementId alone selects just that element (see the store's set).
   */
  selected: string[];
  keyframeId: string | null;
  playhead: number;
  playing: boolean;
  past: Project[];
  future: Project[];
  saveState: "saved" | "dirty" | "saving" | "error";
  savedAt: number;
  /** A short-lived message for the top bar, e.g. after merging another tab's changes. */
  notice: string | null;
  lastCoalesce: { key: string; at: number } | null;
}

interface Actions {
  load(): Promise<void>;
  /** Mutates the project. Edits sharing a coalesce key within a second form one undo step. */
  update(recipe: (p: Project) => void, coalesce?: string): void;
  undo(): void;
  redo(): void;
  set(partial: Partial<State>): void;
  selectSlide(id: string | null): void;
  selectElement(id: string | null, keyframeId?: string | null): void;
  /** Shift-click: adds an element to the selection, or takes it out. */
  toggleSelected(id: string): void;
  /** Selects these elements (the last one leads). */
  selectMany(ids: string[]): void;
  /** Edits a container's children (a child of the current level). */
  enter(id: string): void;
  /** Goes back out to `depth` levels deep (0 is the slide), selecting the container left. */
  exitTo(depth: number): void;
  refreshSources(): Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * The project as the server last had it for this tab, and that revision: what
 * a save is based on, and the common ancestor when merging with another tab.
 */
let base: { project: Project; revision: string } | null = null;
/** Saves run one at a time, so a tab never conflicts with its own save in flight. */
let saving: Promise<void> = Promise.resolve();

export const useStore = create<State & Actions>((rawSet, get) => {
  // Setting elementId on its own selects just that element: the selection follows unless it's given too.
  const set = ((partial: Partial<State> | ((st: State & Actions) => Partial<State>)) =>
    rawSet((st) => {
      const p = typeof partial === "function" ? partial(st) : partial;
      return "elementId" in p && !("selected" in p) ? { ...p, selected: p.elementId ? [p.elementId] : [] } : p;
    })) as typeof rawSet;
  const notify = (notice: string) => {
    if (noticeTimer) clearTimeout(noticeTimer);
    set({ notice });
    noticeTimer = setTimeout(() => set({ notice: null }), 6000);
  };

  /** Shows a project that came from elsewhere, keeping the selection where it still exists. */
  const adopt = (next: Project) => {
    const { slideId, elementId } = get();
    const all = [...next.slides, ...(next.systemSlides ?? [])];
    const slide = all.find((s) => s.id === slideId);
    // Keep the entered containers and selection if they still exist.
    const ctx = slide ? editContext(slide, get().inside, get().previewItem, {}) : null;
    const inside = ctx ? ctx.levels.map((l) => l.container.id) : [];
    set({
      project: next,
      slideId: slide ? slideId : (next.slides[0]?.id ?? null),
      inside,
      elementId: ctx?.elements.some((el) => el.id === elementId) ? elementId : null,
      selected: get().selected.filter((id) => ctx?.elements.some((el) => el.id === id)),
      keyframeId: null,
      // Undo steps from before would silently revert the other change.
      past: [],
      future: [],
      lastCoalesce: null,
    });
  };

  const saveNow = async () => {
    const p = get().project;
    if (!p || !base) return;
    if (p === base.project) return set({ saveState: "saved" }); // e.g. undone back to what's saved
    set({ saveState: "saving" });
    try {
      const res = await api.saveProject(p, base.revision);
      if (res.ok) {
        base = { project: p, revision: res.revision };
        if (get().project === p) set({ saveState: "saved", savedAt: Date.now() });
        return;
      }
      // Another tab (or the server) saved since we loaded: merge our edits into
      // theirs rather than overwrite them, then save the result.
      const theirs = res.conflict;
      const { value, conflicts } = merge3(base.project, get().project!, theirs.project);
      base = { project: theirs.project, revision: theirs.revision };
      adopt(value);
      set({ saveState: "dirty" });
      notify(conflicts ? `Merged changes from another tab (${conflicts} clash${conflicts === 1 ? "" : "es"} kept yours)` : "Merged changes from another tab");
      scheduleSave();
    } catch {
      set({ saveState: "error" });
    }
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => (saving = saving.then(saveNow)), 500);
  };

  return {
    project: null,
    plugins: [],
    sourceStatus: {},
    dnd: null,
    deviceTick: 0,
    view: "editor",
    slideId: null,
    inside: [],
    previewItem: 0,
    elementId: null,
    selected: [],
    keyframeId: null,
    playhead: 0,
    playing: false,
    past: [],
    future: [],
    saveState: "saved",
    savedAt: 0,
    notice: null,
    lastCoalesce: null,

    async load() {
      const [{ project, revision }, plugins] = await Promise.all([api.project(), api.plugins()]);
      base = { project, revision };
      const deck = project.decks.find((d) => d.id === project.activeDeckId);
      const first = deck?.items[0]?.slideId ?? project.slides[0]?.id ?? null;
      set({ project, plugins, slideId: first });
      await get().refreshSources();

      // The project changed elsewhere (another tab, or an API client): reload it.
      // With edits of our own waiting, leave it: their save merges instead.
      const reloadProject = async () => {
        if (get().saveState !== "saved") return;
        const fresh = await api.project();
        if (get().saveState !== "saved") return;
        base = { project: fresh.project, revision: fresh.revision };
        if (JSON.stringify(fresh.project) === JSON.stringify(get().project)) {
          set({ project: fresh.project }); // same content: just adopt it as the base
          return;
        }
        adopt(fresh.project);
      };

      // Fresh data is pushed as soon as the server fetches it (EventSource reconnects on its own).
      let events: EventSource | null = null;
      const connect = () => {
        events = new EventSource("/api/events");
        // Sent on every connect, so a returning tab catches up on these two by itself.
        events.addEventListener("dnd", (e) => set({ dnd: JSON.parse((e as MessageEvent).data) as DndState }));
        events.addEventListener("device", () => set({ deviceTick: get().deviceTick + 1 }));
        events.addEventListener("sources", (e) => {
          const list = JSON.parse((e as MessageEvent).data) as SourceStatus[];
          set({ sourceStatus: Object.fromEntries(list.map((s) => [s.id, s])) });
        });
        events.addEventListener("project", (e) => {
          const { origin, revision } = JSON.parse((e as MessageEvent).data) as { origin: string; revision: string };
          if (origin !== CLIENT_ID && revision !== base?.revision) void reloadProject();
        });
      };
      // A browser allows only 6 open connections per host, and each stream holds
      // one for good; with 6 editor tabs open, a 7th would never load. So
      // background tabs let go of theirs, and catch up on coming back.
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          events?.close();
          events = null;
        } else if (!events) {
          connect();
          void reloadProject();
        }
      });
      if (!document.hidden) connect();
    },

    update(recipe, coalesce) {
      const { project, past, lastCoalesce } = get();
      if (!project) return;
      // Discard the recipe's return value: terse handlers like `(d) => (d.x = 1)`
      // return the assigned value, which immer would treat as a replacement.
      const next = produce(project, (draft) => {
        recipe(draft);
      });
      if (next === project) return;
      const now = Date.now();
      const merge = coalesce && lastCoalesce && lastCoalesce.key === coalesce && now - lastCoalesce.at < 1000;
      set({
        project: next,
        past: merge ? past : [...past.slice(-99), project],
        future: [],
        saveState: "dirty",
        lastCoalesce: coalesce ? { key: coalesce, at: now } : null,
      });
      scheduleSave();
    },

    undo() {
      const { past, project, future } = get();
      if (!past.length || !project) return;
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], saveState: "dirty", lastCoalesce: null });
      scheduleSave();
    },

    redo() {
      const { past, project, future } = get();
      if (!future.length || !project) return;
      set({ project: future[0], future: future.slice(1), past: [...past, project], saveState: "dirty", lastCoalesce: null });
      scheduleSave();
    },

    set: (partial) => set(partial),

    selectSlide(id) {
      set({ slideId: id, inside: [], previewItem: 0, elementId: null, keyframeId: null, playhead: 0 });
    },

    enter(id) {
      set((st) => ({ inside: [...st.inside, id], previewItem: 0, elementId: null, keyframeId: null, playhead: 0, playing: false }));
    },

    exitTo(depth) {
      const { inside, playhead } = get();
      if (depth >= inside.length) return;
      // Back at the slide, carry on from the same moment; deeper, start the level over.
      const ctx = currentContext();
      set({ inside: inside.slice(0, depth), elementId: inside[depth], keyframeId: null, playhead: depth === 0 && ctx ? ctx.toSlideTime(playhead) : 0, playing: false });
    },

    selectElement(id, keyframeId = null) {
      set({ elementId: id, keyframeId });
    },

    toggleSelected(id) {
      const cur = selectionOf(get());
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      set({ selected: next, elementId: next.includes(id) ? id : (next.at(-1) ?? null), keyframeId: null });
    },

    selectMany(ids) {
      set({ selected: ids, elementId: ids.at(-1) ?? null, keyframeId: null });
    },

    async refreshSources() {
      try {
        const list = await api.sourceStatus();
        set({ sourceStatus: Object.fromEntries(list.map((s) => [s.id, s])) });
      } catch {
        /* server briefly unavailable */
      }
    },
  };
});

/** Fetched values by source id, falling back to each plugin's sample data. */
export function fetchedWithSamples(project: Project, plugins: PluginInfo[], status: Record<string, SourceStatus>) {
  const out: Record<string, unknown> = {};
  for (const s of project.sources) {
    const data = status[s.id]?.data;
    out[s.id] = data ?? plugins.find((p) => p.id === s.plugin)?.sample ?? null;
  }
  return out;
}

/**
 * Binding values at an instant. For a system slide (the given one, or the one
 * being edited) this includes its sample {{notify.*}} data; inside a rotator,
 * the previewed item's {{item.*}}, {{index}} and {{count}}.
 */
export function scopeAt(epochMs: number, slide?: Slide | null): Scope {
  const { project, plugins, sourceStatus, slideId, inside, previewItem } = useStore.getState();
  if (!project) return {};
  const scope = buildScope(project.sources, fetchedWithSamples(project, plugins, sourceStatus), epochMs);
  const s = slide === undefined ? findSlide(project, slideId) : slide;
  if (s?.system) Object.assign(scope, sampleScope(s.system));
  if (slide === undefined && s && inside.length) return editContext(s, inside, previewItem, scope).scope(scope);
  return scope;
}

/** Where editing is happening right now (see context.ts), for event handlers and render loops. */
export function currentContext(): EditContext | null {
  const { project, slideId, inside, previewItem } = useStore.getState();
  const slide = project && findSlide(project, slideId);
  if (!slide) return null;
  return editContext(slide, inside, previewItem, baseScope(slide));
}

/** A slide's length for lists: fitted to its content, what that is right now ("12s fit"). */
export function slideLength(slide: Slide): string {
  return slide.fit ? `${fittedSec(slide, scopeAt(Date.now(), slide))}s fit` : `${slide.durationSec}s`;
}

/** The selected elements' ids: the selection, which always includes elementId. */
export function selectionOf(st: Pick<State, "elementId" | "selected">): string[] {
  if (!st.elementId) return [];
  return st.selected.includes(st.elementId) ? st.selected : [st.elementId];
}

/** The selected elements' ids, kept current. */
export function useSelection(): string[] {
  const elementId = useStore((s) => s.elementId);
  const selected = useStore((s) => s.selected);
  return useMemo(() => selectionOf({ elementId, selected }), [elementId, selected]);
}

/** The timeline being edited: its length and outro line, for placing keys (see context.ts). */
export function currentClock(): Clock {
  return currentContext()?.clock ?? { end: 0, outroMs: 0 };
}

/** Data bindings without the entered rotator's item: what the level's containers themselves see. */
function baseScope(slide: Slide): Scope {
  const { project, plugins, sourceStatus } = useStore.getState();
  if (!project) return {};
  const scope = buildScope(project.sources, fetchedWithSamples(project, plugins, sourceStatus), Date.now());
  if (slide.system) Object.assign(scope, sampleScope(slide.system));
  return scope;
}

/** The editing context, kept current as the project, level, item or data change. */
export function useEditContext(): EditContext | null {
  const project = useStore((s) => s.project);
  const slideId = useStore((s) => s.slideId);
  const inside = useStore((s) => s.inside);
  const previewItem = useStore((s) => s.previewItem);
  const sources = useStore((s) => s.sourceStatus);
  return useMemo(() => {
    const slide = project && findSlide(project, slideId);
    return slide ? editContext(slide, inside, previewItem, baseScope(slide)) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, slideId, inside, previewItem, sources]);
}

/** Binding values from real data only (no samples): what the server sees when choosing slides. */
export function liveScopeAt(epochMs: number): Scope {
  const { project, sourceStatus } = useStore.getState();
  if (!project) return {};
  return buildScope(project.sources, Object.fromEntries(project.sources.map((s) => [s.id, sourceStatus[s.id]?.data ?? null])), epochMs);
}
