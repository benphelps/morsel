import { useEffect } from "react";
import { DataView } from "./components/DataView";
import { DeckView } from "./components/DeckView";
import { DeviceView, useDeviceStatus } from "./components/DeviceView";
import { DialogHost } from "./components/Dialogs";
import { EditorView } from "./components/EditorView";
import { api } from "./api";
import { useStore, type View } from "./store";
import { Icon } from "./components/Icon";

const TABS: { id: View; label: string }[] = [
  { id: "editor", label: "Editor" },
  { id: "system", label: "System" },
  { id: "deck", label: "Deck" },
  { id: "data", label: "Data" },
  { id: "device", label: "Device" },
];

export function App() {
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.view);
  const saveState = useStore((s) => s.saveState);
  const notice = useStore((s) => s.notice);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { set, undo, redo, load, refreshSources } = useStore.getState();
  const device = useDeviceStatus(5000);

  useEffect(() => {
    load().catch((e) => console.error(e));
    const t = setInterval(refreshSources, 30_000);
    const warn = (e: BeforeUnloadEvent) => {
      if (useStore.getState().saveState !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", warn);
    };
  }, []);

  if (!project) return <div className="loading">Loading…</div>;

  // The editor and System tabs share the stage; keep each on a slide of its own kind.
  const switchView = (next: View) => {
    const st = useStore.getState();
    const p = st.project!;
    const current = [...p.slides, ...(p.systemSlides ?? [])].find((s) => s.id === st.slideId);
    const wantSystem = next === "system";
    if ((next === "editor" || wantSystem) && !!current?.system !== wantSystem) {
      const first = wantSystem ? p.systemSlides?.[0] : p.slides[0];
      st.selectSlide(first?.id ?? null);
    }
    set({ view: next, playing: false });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="logo-dots" aria-hidden>
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
          morsel
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={view === t.id ? "on" : ""} onClick={() => switchView(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <button className="btn icon-btn" disabled={!canUndo} title="Undo (⌘Z)" onClick={undo}>
          <Icon name="undo" />
        </button>
        <button className="btn icon-btn" disabled={!canRedo} title="Redo (⇧⌘Z)" onClick={redo}>
          <Icon name="redo" />
        </button>
        <DndButton />
        {notice && <span className="save-notice">{notice}</span>}
        <span className={`save-state ${saveState}`}>{{ saved: "Saved", dirty: "Unsaved", saving: "Saving…", error: "Save failed" }[saveState]}</span>
        <button className={`pill ${device?.connected ? "live" : "off"}`} onClick={() => set({ view: "device" })}>
          <span className="status-dot" />
          {device?.connected ? (device.current?.name ?? "Connected") : "Device offline"}
        </button>
      </header>
      <main className="content">
        {view === "editor" && <EditorView key="library" />}
        {view === "system" && <EditorView key="system" mode="system" />}
        {view === "deck" && <DeckView />}
        {view === "data" && <DataView />}
        {view === "device" && <DeviceView />}
      </main>
      <DialogHost />
    </div>
  );
}

function untilText(until: number | null) {
  return until ? new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

/** One-click Do Not Disturb; the Device tab has durations and options. */
function DndButton() {
  const dnd = useStore((s) => s.dnd);
  const on = !!dnd?.enabled;
  return (
    <button
      className={`dnd-btn ${on ? "on" : ""}`}
      title={on ? "Turn off Do Not Disturb" : "Do Not Disturb: pause the deck on one calm slide"}
      onClick={() => api.setDnd({ enabled: !on })}
    >
      <Icon name="moon" size={13} />
      {on ? (dnd?.until ? `Until ${untilText(dnd.until)}` : "DND on") : "DND"}
    </button>
  );
}
