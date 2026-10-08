import { Section, Segmented } from "../../web/components/Fields";
import type { PanelProps } from "../types";
import type { EllipseElement } from "./element";

export function EllipsePanel({ el, edit }: PanelProps<EllipseElement>) {
  return (
    <Section id="ellipse" title="Shape">
      <Segmented
        value={el.filled ? "fill" : "outline"}
        options={[
          { value: "fill", label: "Filled" },
          { value: "outline", label: "Outline" },
        ]}
        onChange={(v) => edit((x) => (x.filled = v === "fill"))}
      />
    </Section>
  );
}
