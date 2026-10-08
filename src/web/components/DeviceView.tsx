import { useEffect, useState } from "react";
import { Note, NoteRow } from "./Fields";
import { ICONS } from "../../shared/icons";
import type { DeviceStatus } from "../../shared/types";
import { api } from "../api";
import { useStore } from "../store";
import { DeviceMirror } from "./DeviceMirror";
import { Icon } from "./Icon";

const TIMEZONES: string[] = (() => {
  try {
    return (Intl as any).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
})();

type LiveStatus = DeviceStatus & { brightnessNow: number; hosts: string[]; now: number };

/**
 * The device's status, polled, and fetched again the moment the server says
 * the display moved on. Carries `clockOffset` (the server's clock minus ours),
 * to line the mirror up with when the device started its clip.
 */
export function useDeviceStatus(intervalMs = 3000) {
  const [status, setStatus] = useState<(LiveStatus & { clockOffset: number }) | null>(null);
  const tick = useStore((s) => s.deviceTick);
  useEffect(() => {
    let alive = true;
    const poll = () => {
      const sent = Date.now();
      api
        .device()
        .then((s) => {
          if (!alive) return;
          // The server read its clock about halfway through the round trip.
          const clockOffset = s.now - (sent + Date.now()) / 2;
          setStatus({ ...s, clockOffset });
        })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs, tick]);
  return status;
}

export function DeviceView() {
  const project = useStore((s) => s.project!);
  const { update } = useStore.getState();
  const status = useDeviceStatus(2000);
  const [text, setText] = useState("Hello from morsel!");
  const [icon, setIcon] = useState("bell");
  // Prefer the address the browser used, unless that's this machine's loopback;
  // in dev the editor runs on Vite's port while the device talks to the API server.
  const loopback = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
  const browserHost = import.meta.env.DEV ? window.location.host.replace(/:\d+$/, ":8000") : window.location.host;
  const deviceHost = loopback ? (status?.hosts[0] ?? browserHost) : browserHost;
  const d = project.device;
  const setDevice = (fn: (dev: typeof d) => void, key?: string) => update((p) => fn(p.device), key);

  return (
    <div className="device-view">
      <section className="card-block">
        <h3>
          Status <span className={`pill ${status?.connected ? "live" : "off"}`}><span className="status-dot" />
            {status?.connected ? `Connected (${status.transport})` : "Not connected"}</span>
        </h3>
        <div className="mirror">
          {status?.current ? (
            <DeviceMirror clip={status.current.clip} since={status.current.since} next={status.queued?.clip} clockOffset={status.clockOffset} />
          ) : (
            <div className="mirror-empty dim">Nothing sent yet</div>
          )}
        </div>
        {status?.current && (
          <div className="small">
            Showing <b>{status.current.name}</b> · <span className="mono">{status.current.frames}</span> frames ·{" "}
            <span className="mono">{(status.current.bytes / 1024).toFixed(1)} KB</span>
            {status.queued && <span className="dim"> · next: {status.queued.name}</span>}
          </div>
        )}
        {status?.clientInfo && (
          <div className="dim small mono">
            {String(status.clientInfo.firmware_version ?? "")} {String(status.clientInfo.hostname ?? "")} {String(status.clientInfo.mac ?? "")}
          </div>
        )}
      </section>

      <DndCard />

      <section className="card-block">
        <h3>Brightness</h3>
        <label className="field">
          <span className="field-label">
            Daytime <span className="mono dim">{d.brightness}%</span>
          </span>
          <input type="range" min={0} max={100} value={d.brightness} onChange={(e) => setDevice((x) => (x.brightness = Number(e.target.value)), "bright")} />
        </label>
        <label className="check">
          <input type="checkbox" checked={d.night.enabled} onChange={(e) => setDevice((x) => (x.night.enabled = e.target.checked))} /> Dim at night
        </label>
        {d.night.enabled && (
          <div className="row gap wrap">
            <label className="field">
              <span className="field-label">From</span>
              <input type="time" value={d.night.start} onChange={(e) => setDevice((x) => (x.night.start = e.target.value))} />
            </label>
            <label className="field">
              <span className="field-label">Until</span>
              <input type="time" value={d.night.end} onChange={(e) => setDevice((x) => (x.night.end = e.target.value))} />
            </label>
            <label className="field grow">
              <span className="field-label">
                Night brightness <span className="mono dim">{d.night.brightness}%</span>
              </span>
              <input type="range" min={0} max={100} value={d.night.brightness} onChange={(e) => setDevice((x) => (x.night.brightness = Number(e.target.value)), "nbright")} />
            </label>
          </div>
        )}
        <label className="field">
          <span className="field-label">Schedule time zone</span>
          <select value={d.timezone} onChange={(e) => setDevice((x) => (x.timezone = e.target.value))}>
            {TIMEZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        {status && (
          <Note>
            <NoteRow label="Brightness right now" value={`${status.brightnessNow}%`} />
          </Note>
        )}
      </section>

      <section className="card-block">
        <h3>Animation</h3>
        <label className="field">
          <span className="field-label">Frame rate</span>
          <select value={project.fps} onChange={(e) => update((p) => void (p.fps = Number(e.target.value)))}>
            <option value={10}>10 fps: smallest files</option>
            <option value={20}>20 fps: smooth (recommended)</option>
            <option value={25}>25 fps</option>
            <option value={50}>50 fps: smoothest, largest files</option>
          </select>
        </label>
        <p className="dim small">Frames that don't change are merged, so still slides stay tiny at any frame rate.</p>
      </section>

      <section className="card-block">
        <h3>Send a notification</h3>
        <p className="dim small">Interrupts the deck with a one-off slide, then carries on.</p>
        <div className="row gap wrap">
          <input className="grow" value={text} onChange={(e) => setText(e.target.value)} />
          <select value={icon} onChange={(e) => setIcon(e.target.value)}>
            <option value="">No icon</option>
            {Object.keys(ICONS).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <button className="btn primary" onClick={() => api.notify({ text, icon: icon || undefined })}>
            Send
          </button>
        </div>
        <pre className="code small">{`curl -X POST http://${deviceHost}/api/notify \\
  -H 'content-type: application/json' \\
  -d '{"text":"Doorbell!","icon":"bell","color":"#ffc21a","durationSec":10}'`}</pre>
      </section>

      <section className="card-block wide">
        <h3>Connect your Tidbyt</h3>
        <ol className="steps">
          <li>
            Flash the <a href="https://github.com/tronbyt/firmware-esp32" target="_blank" rel="noreferrer">tronbyt firmware</a> (Gen 1: <span className="mono">make tidbyt-gen1</span>).
          </li>
          <li>
            Set its image URL (in <span className="mono">secrets.json</span> as <span className="mono">REMOTE_URL</span>, or on the device's setup page at <span className="mono">http://10.10.0.1</span>) to:
            <pre className="code">ws://{deviceHost}/device/ws</pre>
            WebSocket is best: slides are pushed the moment they're ready and the mirror above stays exact. Plain polling also works:
            <pre className="code">http://{deviceHost}/device/next</pre>
          </li>
          <li>
            Use your Mac's LAN IP or hostname, not <span className="mono">localhost</span>. The device needs to reach port 8000 on your Mac.
          </li>
        </ol>
      </section>
    </div>
  );
}

function DndCard() {
  const dnd = useStore((s) => s.dnd);
  const slides = useStore((s) => s.project?.slides ?? []);
  const { set, selectSlide } = useStore.getState();
  if (!dnd) return null;
  const until = dnd.until ? new Date(dnd.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <section className="card-block">
      <h3>
        Do Not Disturb <span className={`pill ${dnd.enabled ? "live" : "off"}`}>{dnd.enabled && <Icon name="moon" size={12} />}
          {dnd.enabled ? (until ? `On until ${until}` : "On") : "Off"}</span>
      </h3>
      <p className="dim small">Pauses the deck on one slide and holds back notifications, e.g. while you're in a meeting.</p>
      <div className="row gap wrap">
        <button className="btn primary" onClick={() => api.setDnd({ enabled: !dnd.enabled })}>
          {dnd.enabled ? "Turn off" : "Turn on"}
        </button>
        {[30, 60, 120].map((m) => (
          <button key={m} className="btn" onClick={() => api.setDnd({ minutes: m })}>
            {m < 60 ? `${m} min` : `${m / 60} hour${m > 60 ? "s" : ""}`}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field-label">Show</span>
        <select value={dnd.slideId ?? ""} onChange={(e) => api.setDnd({ slideId: e.target.value || null })}>
          <option value="">The “Do Not Disturb” system slide</option>
          {slides.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {!dnd.slideId && (
        <button
          className="btn small"
          onClick={() => {
            selectSlide("sys_dnd");
            set({ view: "system" });
          }}
        >
          Edit the Do Not Disturb slide
        </button>
      )}
      <label className="check">
        <input type="checkbox" checked={dnd.brightness != null} onChange={(e) => api.setDnd({ brightness: e.target.checked ? 10 : null })} /> Dim while on
      </label>
      {dnd.brightness != null && (
        <label className="field">
          <span className="field-label">
            Brightness <span className="mono dim">{dnd.brightness}%</span>
          </span>
          <input type="range" min={0} max={100} value={dnd.brightness} onChange={(e) => api.setDnd({ brightness: Number(e.target.value) })} />
          <Note tone="muted">Never brighter than your normal or night brightness.</Note>
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={dnd.muteNotifications} onChange={(e) => api.setDnd({ muteNotifications: e.target.checked })} /> Hold back notifications and Now Playing
      </label>
    </section>
  );
}
