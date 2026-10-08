import { numberPaths, resolveNumber, type Scope } from "../../shared/bindings";
import type { ColorFrom } from "../../shared/types";
import { dataColor } from "../../elements";
import { BindingField } from "./BindingField";
import { ColorField, Note, NumberField, Segmented } from "./Fields";

const UP = "#32d46a";
const DOWN = "#ff4040";
const FLAT = "#aab6c4";

/**
 * The number a new "from data" colour starts on: one that sounds like a
 * change (change, diff, delta…), the item's own first if inside a rotator.
 */
export function suggestColorValue(scope: Scope): string {
  const paths = numberPaths(scope);
  const changey = (p: string) => /change|diff|delta|trend|move/i.test(p.split(".").pop() ?? "");
  const pick = paths.find((p) => p.startsWith("item.") && changey(p)) ?? paths.find((p) => p.startsWith("item.")) ?? paths.find(changey) ?? paths[0];
  return pick ? `{{${pick}}}` : "";
}

/** A small colour well with its label, for the three colours side by side. */
function Well({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="well" title={`${label}: ${value}`}>
      <span className="well-swatch" style={{ background: value }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
      <span className="field-label">{label}</span>
    </label>
  );
}

/**
 * An element's colour: fixed (and keyframable), or picked by a number from
 * the data, e.g. green above 0 and red below.
 */
export function ColourControl({
  color,
  keyed,
  colorFrom,
  scope,
  onColor,
  onColorFrom,
}: {
  color: string;
  keyed?: boolean;
  colorFrom?: ColorFrom;
  scope: Scope;
  onColor: (v: string) => void;
  onColorFrom: (c: ColorFrom | undefined, coalesce?: string) => void;
}) {
  const value = colorFrom ? resolveNumber(colorFrom.value, scope) : null;
  const now = dataColor(colorFrom, scope);
  const set = (patch: Partial<ColorFrom>, coalesce?: string) => colorFrom && onColorFrom({ ...colorFrom, ...patch }, coalesce);
  return (
    <>
      <Segmented
        value={colorFrom ? "data" : "fixed"}
        options={[
          { value: "fixed", label: "Fixed colour", title: "One colour (which can be keyframed)" },
          { value: "data", label: "From data", title: "A number picks the colour, e.g. green while a price is up and red while it's down" },
        ]}
        onChange={(v) => onColorFrom(v === "data" ? { value: suggestColorValue(scope), threshold: 0, above: UP, below: DOWN, equal: FLAT } : undefined)}
      />
      {!colorFrom ? (
        <ColorField label="" value={color} keyed={keyed} onChange={onColor} />
      ) : (
        <>
          <div className="field">
            <span className="field-label">Number</span>
            <BindingField kind="number" value={colorFrom.value} placeholder="Pick a number…" scope={scope} onChange={(v) => set({ value: v })} />
          </div>
          <NumberField label="Compared with" value={colorFrom.threshold ?? 0} step={1} onChange={(v) => set({ threshold: v }, "colorfrom-threshold")} />
          <div className="wells">
            <Well label="Above" value={colorFrom.above} onChange={(v) => set({ above: v }, "colorfrom-above")} />
            <Well label="Below" value={colorFrom.below} onChange={(v) => set({ below: v }, "colorfrom-below")} />
            <Well label="Equal" value={colorFrom.equal ?? colorFrom.above} onChange={(v) => set({ equal: v }, "colorfrom-equal")} />
          </div>
          {value == null ? (
            <Note tone="warn">That isn't a number right now, so it keeps its own colour.</Note>
          ) : (
            <Note tone="muted">
              <span className="row gap">
                It's {value} now
                <span className="well-swatch small" style={{ background: now ?? color }} />
              </span>
            </Note>
          )}
        </>
      )}
    </>
  );
}
