import { NumberField, Section, Segmented } from "../../web/components/Fields";
import type { PanelProps } from "../types";
import type { RectElement } from "./element";

export function RectPanel({ el, edit }: PanelProps<RectElement>) {
  return (
    <Section id="rect" title="Shape">
      <div className="row gap">
        <Segmented
          value={el.filled ? "fill" : "outline"}
          options={[
            { value: "fill", label: "Filled" },
            { value: "outline", label: "Outline" },
          ]}
          onChange={(v) => edit((x) => (x.filled = v === "fill"))}
        />
        <NumberField label="Radius" min={0} max={16} value={el.radius} onChange={(v) => edit((x) => (x.radius = v), `rad-${el.id}`)} />
      </div>
    </Section>
  );
}
