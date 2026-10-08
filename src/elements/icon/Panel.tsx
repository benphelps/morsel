import { IconGrid, Note, NumberField, Section } from "../../web/components/Fields";
import { setEverywhere } from "../../web/model";
import { BindingField } from "../../web/components/BindingField";
import type { PanelProps } from "../types";
import { iconBoxSize, type IconElement } from "./element";

/** Snap the box to the icon after picking one or changing its scale. */
function fit(x: IconElement) {
  const size = iconBoxSize(x);
  if (size) setEverywhere(x, size);
}

export function IconPanel({ el, edit }: PanelProps<IconElement>) {
  return (
    <Section id="icon" title="Icon" summary={el.icon}>
      <IconGrid
        value={el.icon}
        hires={!el.blocky && el.scale % 2 === 0}
        onPick={(name) =>
          edit((x) => {
            x.icon = name;
            fit(x);
          })
        }
      />
      <div className="field">
        <span className="field-label">Icon name or binding</span>
        <BindingField kind="text" mode="type" value={el.icon} placeholder="An icon's name, or a field" onChange={(v) => edit((x) => (x.icon = v), `icon-${el.id}`)} />
      </div>
      <Note tone="muted">Bound icons are centred in the box, so leave room for the largest one: weather icons are up to 17×12, or 34×24 at 2×.</Note>
      <div className="row gap wrap">
        <NumberField
          label="Scale"
          min={1}
          max={4}
          value={el.scale}
          onChange={(v) =>
            edit((x) => {
              x.scale = v;
              fit(x);
            })
          }
        />
        <label className="check">
          <input type="checkbox" checked={el.tint} onChange={(e) => edit((x) => (x.tint = e.target.checked))} /> Use colour
        </label>
        {el.scale % 2 === 0 && (
          <label className="check" title="Double the 1× pixels instead of using the detailed 2× drawing">
            <input
              type="checkbox"
              checked={!!el.blocky}
              onChange={(e) =>
                edit((x) => {
                  x.blocky = e.target.checked;
                  fit(x);
                })
              }
            />{" "}
            Blocky
          </label>
        )}
      </div>
    </Section>
  );
}
