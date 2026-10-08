import { Note, Section } from "../../web/components/Fields";
import { listOf, ungroup } from "../../web/model";
import { currentClock, useStore } from "../../web/store";
import type { PanelProps } from "../types";
import type { GroupElement } from "./element";

export function GroupPanel({ el, slide, edit }: PanelProps<GroupElement>) {
  const n = el.children.length;
  const { enter, update, set } = useStore.getState();
  return (
    <Section id="group" title="Group">
      <Note tone="muted">
        {n ? `${n} element${n === 1 ? "" : "s"} that move, fade and animate together.` : "Empty."} Double-click it on the canvas or in the layers to work inside.
      </Note>
      <div className="row gap wrap">
        <button className="btn small" onClick={() => enter(el.id)}>
          Edit contents
        </button>
        <button
          className="btn small"
          title="Put its elements back where the group is (⇧⌘G)"
          disabled={!n}
          onClick={() => {
            update((p) => {
              const list = listOf(p, slide.id, el.id);
              if (list) ungroup(list, el.id, useStore.getState().playhead, currentClock().end);
            });
            set({ elementId: null });
          }}
        >
          Ungroup
        </button>
      </div>
      <label className="check" title="Cut off anything inside that goes past the group's box">
        <input type="checkbox" checked={el.clip} onChange={(e) => edit((x) => (x.clip = e.target.checked))} /> Clip to its box
      </label>
    </Section>
  );
}
