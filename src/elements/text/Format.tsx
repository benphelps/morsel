import { useState } from "react";
import { bindingsIn, lookup, numFilter, parseNumFilter, replaceBinding, resolveTemplate, type NumberFormat, type Scope } from "../../shared/bindings";
import { NoteRow, Note, Segmented } from "../../web/components/Fields";

/**
 * How the numbers in a text show: decimals, separators, sign, percent or
 * compact, and a prefix or suffix. It edits the binding's `num` filter, so the
 * format stays visible (and editable by hand) in the text itself.
 */
export function NumberFormatSection({ text, scope, onText }: { text: string; scope: Scope; onText: (text: string, coalesce?: string) => void }) {
  const refs = bindingsIn(text).filter((r) => typeof lookup(scope, r.path) === "number");
  const [pick, setPick] = useState(0);
  if (!refs.length) return null;
  const which = Math.min(pick, refs.length - 1);
  const ref = refs[which];
  const at = ref.filters.findIndex((f) => parseNumFilter(f));
  const fmt: NumberFormat = at >= 0 ? parseNumFilter(ref.filters[at])! : { style: "plain" };
  const formatted = at >= 0;

  const write = (patch: Partial<NumberFormat>, coalesce?: string) => {
    const filters = [...ref.filters];
    const next = numFilter({ ...fmt, ...patch });
    if (at >= 0) filters[at] = next;
    else filters.push(next);
    onText(replaceBinding(text, ref, filters), coalesce && `${coalesce}-${which}`);
  };
  const clear = () => onText(replaceBinding(text, ref, ref.filters.filter((_, i) => i !== at)));
  const shows = resolveTemplate(`{{${[ref.path, ...ref.filters].join("|")}}}`, scope);

  return (
    <>
      {refs.length > 1 && (
        <label className="field">
          <span className="field-label">Number</span>
          <select value={which} onChange={(e) => setPick(Number(e.target.value))}>
            {refs.map((r, i) => (
              <option key={i} value={i}>
                {r.path}
              </option>
            ))}
          </select>
        </label>
      )}
      <Segmented
        value={fmt.style ?? "plain"}
        options={[
          { value: "plain", label: "Number", title: "1234.5" },
          { value: "pct", label: "Percent", title: "Adds a % (for values already in percent, like 1.25)" },
          { value: "compact", label: "Compact", title: "1.2K, 3.4M, 5.6B" },
        ]}
        onChange={(v) => write({ style: v })}
      />
      <div className="format-grid">
        <label className="field">
          <span className="field-label">Decimals</span>
          <select value={fmt.decimals ?? ""} onChange={(e) => write({ decimals: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">Auto</option>
            {[0, 1, 2, 3, 4].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Before</span>
          <input value={fmt.prefix ?? ""} placeholder="$" maxLength={6} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => write({ prefix: e.target.value }, "fmt-pre")} />
        </label>
        <label className="field">
          <span className="field-label">After</span>
          <input value={fmt.suffix ?? ""} placeholder=" USD" maxLength={8} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => write({ suffix: e.target.value }, "fmt-suf")} />
        </label>
      </div>
      <div className="row gap wrap">
        <label className="check" title="1,234,567">
          <input type="checkbox" checked={!!fmt.comma} onChange={(e) => write({ comma: e.target.checked })} /> Separators
        </label>
        <label className="check" title="+1.20 as well as -1.20">
          <input type="checkbox" checked={!!fmt.sign} onChange={(e) => write({ sign: e.target.checked })} /> Always + / −
        </label>
        {formatted && (
          <button className="link small" onClick={clear} title="Show the number as it comes">
            Reset
          </button>
        )}
      </div>
      <Note>
        <NoteRow label="Shows" value={shows} />
      </Note>
    </>
  );
}

/** A folded Number format section's summary: the first number as it shows, and whether it's formatted. */
export function numberFormatSummary(text: string, scope: Scope): string {
  const ref = bindingsIn(text).find((r) => typeof lookup(scope, r.path) === "number");
  if (!ref) return "";
  const shows = resolveTemplate(`{{${[ref.path, ...ref.filters].join("|")}}}`, scope);
  return ref.filters.some((f) => parseNumFilter(f)) ? shows : `As it comes · ${shows}`;
}
