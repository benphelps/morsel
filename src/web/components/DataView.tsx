import { useEffect, useMemo, useState } from "react";
import { confirmDialog } from "./Dialogs";
import { Note } from "./Fields";
import { rewriteBindings } from "../../elements";
import { flattenPaths } from "../../shared/bindings";
import { uid } from "../../shared/id";
import type { ConfigField, PluginInfo, SourceInstance } from "../../shared/types";
import { api } from "../api";
import { scopeAt, useStore } from "../store";

const TIMEZONES: string[] = (() => {
  try {
    return (Intl as any).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
})();

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export function DataView() {
  const project = useStore((s) => s.project!);
  const plugins = useStore((s) => s.plugins);
  const status = useStore((s) => s.sourceStatus);
  const [selId, setSelId] = useState<string | null>(project.sources[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const { update, refreshSources } = useStore.getState();


  const sel = project.sources.find((s) => s.id === selId) ?? null;

  const add = (p: PluginInfo) => {
    let alias = p.defaultAlias;
    for (let n = 2; project.sources.some((s) => s.alias === alias); n++) alias = `${p.defaultAlias}${n}`;
    const config = { ...p.defaultConfig };
    if (p.fields.some((f) => f.type === "timezone")) config.timezone = project.device.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const src: SourceInstance = { id: uid("src_"), alias, plugin: p.id, config, refreshSec: p.defaultRefreshSec };
    update((d) => void d.sources.push(src));
    setSelId(src.id);
    setAdding(false);
    setTimeout(refreshSources, 1500);
  };

  return (
    <div className="data-view">
      <aside className="source-list">
        <div className="panel-head">
          <span>Data sources</span>
          <button className="btn small primary" onClick={() => setAdding(true)}>
            + Add
          </button>
        </div>
        {project.sources.map((s) => {
          const st = status[s.id];
          const info = plugins.find((p) => p.id === s.plugin);
          return (
            <button key={s.id} className={`source-item ${s.id === selId && !adding ? "on" : ""}`} onClick={() => (setSelId(s.id), setAdding(false))}>
              <span className={`dot ${info?.live ? "live" : st?.error ? "err" : st?.updatedAt ? "ok" : "wait"}`} />
              <span className="mono">{s.alias}</span>
              <span className="dim small">{info?.name}</span>
            </button>
          );
        })}
      </aside>

      <div className="source-detail">
        {adding || !sel ? (
          <div className="plugin-grid">
            <h3>Add a data source</h3>
            <div className="cards">
              {plugins.map((p) => (
                <button key={p.id} className="card" onClick={() => add(p)}>
                  <b>{p.name}</b>
                  <span className="dim small">{p.description}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <SourceEditor key={sel.id} source={sel} plugin={plugins.find((p) => p.id === sel.plugin)} onDeleted={() => setSelId(null)} />
        )}
      </div>
    </div>
  );
}

function SourceEditor({ source, plugin, onDeleted }: { source: SourceInstance; plugin?: PluginInfo; onDeleted: () => void }) {
  const status = useStore((s) => s.sourceStatus[source.id]);
  const project = useStore((s) => s.project!);
  const { update, refreshSources } = useStore.getState();
  const [draft, setDraft] = useState(source.config);
  const [alias, setAlias] = useState(source.alias);
  const [refresh, setRefresh] = useState(source.refreshSec);
  const [test, setTest] = useState<{ ok: boolean; data?: unknown; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!plugin?.live) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [plugin?.live]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(source.config) || alias !== source.alias || refresh !== source.refreshSec;
  const aliasOk = /^[A-Za-z_][A-Za-z0-9_]*$/.test(alias) && !project.sources.some((s) => s.alias === alias && s.id !== source.id);

  const save = () => {
    const old = source.alias;
    update((p) => {
      const s = p.sources.find((x) => x.id === source.id);
      if (!s) return;
      s.config = draft;
      s.alias = alias;
      s.refreshSec = refresh;
      // Keep existing bindings working when a source is renamed.
      if (old !== alias) {
        const re = new RegExp(`\\{\\{\\s*${old}(?=[.|\\s}])`, "g");
        const rename = (t: string) => t.replace(re, `{{${alias}`);
        for (const sl of [...p.slides, ...(p.systemSlides ?? [])]) for (const el of sl.elements) rewriteBindings(el, rename);
        for (const d of p.decks) for (const item of d.items) if (item.showIf) item.showIf = rename(item.showIf);
      }
    });
    setTest(null);
  };

  const live = plugin?.live ? scopeAt(Date.now())[source.alias] : null;
  const data = test?.ok ? test.data : plugin?.live ? live : (status?.data ?? null);
  const paths = useMemo(() => (data != null ? flattenPaths(data, "", 5) : []), [data, tick]);

  return (
    <div className="source-editor">
      <div className="src-head">
        <h3>{plugin?.name ?? source.plugin}</h3>
        <span className="dim small">{plugin?.description}</span>
      </div>

      <div className="src-form">
        <label className="field">
          <span className="field-label">Name in bindings</span>
          <input className={`mono ${aliasOk ? "" : "invalid"}`} value={alias} onChange={(e) => setAlias(e.target.value.trim())} />
          <span className="dim small mono">
            {"{{"}
            {alias}.…{"}}"}
          </span>
        </label>
        {plugin?.fields.map((f) => <ConfigInput key={f.key} field={f} value={draft[f.key]} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />)}
        {!plugin?.live && !plugin?.push && (
          <label className="field">
            <span className="field-label">Refresh every</span>
            <select value={refresh} onChange={(e) => setRefresh(Number(e.target.value))}>
              {[30, 60, 120, 300, 600, 900, 1800, 3600, 21600].map((s) => (
                <option key={s} value={s}>
                  {s < 60 ? `${s} seconds` : s < 3600 ? `${s / 60} minute${s > 60 ? "s" : ""}` : `${s / 3600} hour${s > 3600 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="row gap wrap">
          <button className="btn primary" disabled={!dirty || !aliasOk} onClick={save}>
            Save
          </button>
          {!plugin?.live && !plugin?.push && (
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setTest(await api.testSource(source.plugin, draft));
                setBusy(false);
              }}
            >
              {busy ? "Fetching…" : "Test settings"}
            </button>
          )}
          {!plugin?.live && !plugin?.push && !dirty && (
            <button
              className="btn"
              onClick={async () => {
                await api.refreshSource(source.id);
                setTest(null);
                refreshSources();
              }}
            >
              Refresh now
            </button>
          )}
          <div className="spacer" />
          <button
            className="btn danger"
            onClick={async () => {
              const message = (
                <>
                  Slides using <code>{`{{${source.alias}…}}`}</code> will show “--”.
                </>
              );
              if (!(await confirmDialog({ title: `Remove “${source.alias}”?`, message, confirmLabel: "Remove", danger: true }))) return;
              update((p) => void (p.sources = p.sources.filter((s) => s.id !== source.id)));
              onDeleted();
            }}
          >
            Remove
          </button>
        </div>
        {!plugin?.live && (
          <div className="src-status small">
            {test && !test.ok && <div className="err">Test failed: {test.error}</div>}
            {test?.ok && <div className="ok">Test worked. Save to use these settings.</div>}
            {!test && status?.error && <div className="err">Last fetch failed: {status.error}</div>}
            {!test && status?.updatedAt && <div className="dim">Updated {ago(status.updatedAt)}</div>}
            {!test && !status?.updatedAt && !status?.error && (
              <div className="dim">{plugin?.push ? "Waiting for the Mac app to send data." : "Waiting for the first fetch."} Slides use sample data until then.</div>
            )}
          </div>
        )}
      </div>

      <div className="src-data">
        <div className="panel-head">
          <span>Fields</span>
          <span className="dim small">Click to copy a binding</span>
        </div>
        <div className="paths">
          {paths.map((x) => {
            const b = `{{${alias}${x.path ? "." + x.path : ""}}}`;
            return (
              <button
                key={x.path}
                className="path-row"
                onClick={() => {
                  navigator.clipboard?.writeText(b).catch(() => {});
                  setCopied(x.path);
                  setTimeout(() => setCopied(null), 1200);
                }}
              >
                <span className="mono">{copied === x.path ? "copied ✓" : b}</span>
                <span className="dim trunc">{String(x.value)}</span>
              </button>
            );
          })}
          {!paths.length && <div className="dim pad">No data yet.</div>}
        </div>
      </div>
    </div>
  );
}

function ConfigInput({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (v: unknown) => void }) {
  let input: React.ReactNode;
  switch (field.type) {
    case "boolean":
      return (
        <label className="check">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> {field.label}
        </label>
      );
    case "number":
      input = (
        <input
          type="number"
          value={value == null ? "" : String(value)}
          step={field.step}
          min={field.min}
          max={field.max}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
      break;
    case "select":
      input = (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "timezone":
      input = (
        <select value={String(value ?? "UTC")} onChange={(e) => onChange(e.target.value)}>
          {TIMEZONES.map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
      );
      break;
    default:
      input = <input type={field.secret ? "password" : "text"} value={String(value ?? "")} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <label className="field">
      <span className="field-label">{field.label}</span>
      {input}
      {"help" in field && field.help && <Note tone="muted">{field.help}</Note>}
    </label>
  );
}
