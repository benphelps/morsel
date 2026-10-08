import { Note, Section, Segmented } from "../../web/components/Fields";
import type { PanelProps } from "../types";
import type { LineElement } from "./element";
import { Icon } from "../../web/components/Icon";

export function LinePanel({ el, edit }: PanelProps<LineElement>) {
  return (
    <Section id="line" title="Line">
      <Segmented
        value={el.flip ? "up" : "down"}
        options={[
          {
            value: "down",
            label: (
              <>
                <Icon name="lineDown" size={12} /> Down
              </>
            ),
            title: "Top-left to bottom-right",
          },
          {
            value: "up",
            label: (
              <>
                <Icon name="lineUp" size={12} /> Up
              </>
            ),
            title: "Bottom-left to top-right",
          },
        ]}
        onChange={(v) => edit((x) => (x.flip = v === "up"))}
      />
      <Note tone="muted">The line runs corner to corner across its box. Set H to 1 for a horizontal rule.</Note>
    </Section>
  );
}
