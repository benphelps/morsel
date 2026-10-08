import { resolveNumber, resolveSeries } from "../../shared/bindings";
import { BindingField } from "../../web/components/BindingField";
import { Note, NoteRow, NumberField, Section, Segmented } from "../../web/components/Fields";
import { scopeAt } from "../../web/store";
import type { PanelProps } from "../types";
import { prevCloseFor, setSparklineData, type SparklineElement } from "./element";

export function SparklinePanel({ el, edit }: PanelProps<SparklineElement>) {
  const scope = scopeAt(Date.now());
  const values = resolveSeries(el.data, scope);
  const prevClose = prevCloseFor(el.data, scope);
  // A reference value way off the data's range (another series' close, say) flattens the line.
  const base = resolveNumber(el.baseline, scope);
  const [lo, hi] = values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
  const farOff = base != null && el.showBaseline && values.length >= 2 && (base < lo - 3 * Math.max(hi - lo, Math.abs(hi) * 0.01) || base > hi + 3 * Math.max(hi - lo, Math.abs(hi) * 0.01));
  // This data's own previous close, when the reference isn't it already: a one-click fix.
  const usePrevClose = prevClose && el.baseline !== prevClose && (
    <button className="link" onClick={() => edit((x) => (x.baseline = prevClose))}>
      Use its previous close
    </button>
  );
  return (
    <Section id="sparkline" title="Sparkline" summary={el.data}>
      <div className="field">
        <span className="field-label">Data</span>
        <BindingField kind="series" mode="type" value={el.data} placeholder="A series, or numbers: 3, 5, 4, 8" scope={scope} onChange={(v) => edit((x) => setSparklineData(x, v, scope), `spark-data-${el.id}`)} />
        {values.length >= 2 ? (
          <Note>
            <NoteRow label={`${values.length} points`} value={`${Math.min(...values)} to ${Math.max(...values)}`} />
          </Note>
        ) : (
          <Note tone="warn">Needs at least two numbers to draw.</Note>
        )}
      </div>
      <Segmented
        value={el.style}
        options={[
          { value: "line", label: "Line" },
          { value: "area", label: "Area" },
          { value: "bars", label: "Bars" },
        ]}
        onChange={(v) => edit((x) => (x.style = v))}
      />
      <label className="field">
        <span className="field-label">Colour</span>
        <Segmented
          value={el.colorMode}
          options={[
            { value: "trend", label: "Up / down", title: "Green when the series ends at or above its reference, red below" },
            { value: "fixed", label: "Fixed", title: "Use the element colour (can be keyframed)" },
          ]}
          onChange={(v) => edit((x) => (x.colorMode = v))}
        />
      </label>
      {el.colorMode === "trend" && (
        <div className="grid2">
          <label className="field">
            <span className="field-label">Up</span>
            <input type="color" value={el.upColor} onChange={(e) => edit((x) => (x.upColor = e.target.value), `spark-up-${el.id}`)} />
          </label>
          <label className="field">
            <span className="field-label">Down</span>
            <input type="color" value={el.downColor} onChange={(e) => edit((x) => (x.downColor = e.target.value), `spark-down-${el.id}`)} />
          </label>
        </div>
      )}
      <div className="field">
        <span className="field-label">Reference value</span>
        <BindingField kind="number" mode="type" value={el.baseline} placeholder="A number from the data, or typed" scope={scope} onChange={(v) => edit((x) => (x.baseline = v), `spark-base-${el.id}`)} />
        {farOff ? (
          <Note tone="warn">
            <span>
              {base} is far outside this data ({lo} to {hi}), so the line is squashed flat.{" "}
              {usePrevClose}
            </span>
          </Note>
        ) : (
          <Note tone="muted">
            <span>Up/down is measured against this; without it, against the first point. {usePrevClose}</span>
          </Note>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={el.showBaseline} onChange={(e) => edit((x) => (x.showBaseline = e.target.checked))} /> Dotted reference line
      </label>
      <label className="check">
        <input type="checkbox" checked={el.showLast} onChange={(e) => edit((x) => (x.showLast = e.target.checked))} /> Highlight latest point
      </label>
      <NumberField label="Draw in" suffix="ms" step={100} min={0} max={10000} value={el.revealMs} onChange={(v) => edit((x) => (x.revealMs = v), `spark-reveal-${el.id}`)} />
    </Section>
  );
}
