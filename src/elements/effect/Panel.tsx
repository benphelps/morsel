import { Note, NumberField, Section, Segmented } from "../../web/components/Fields";
import { scopeAt } from "../../web/store";
import { BindingField } from "../../web/components/BindingField";
import type { PanelProps } from "../types";
import { effectKind, type EffectElement } from "./element";

const FIXED = ["rain", "snow", "stars", "clouds", "overcast"] as const;

export function EffectPanel({ el, edit }: PanelProps<EffectElement>) {
  const bound = el.effect.includes("{{");
  const now = effectKind(el, scopeAt(Date.now()));
  const choice = bound ? "data" : (FIXED as readonly string[]).includes(el.effect) ? el.effect : "rain";
  return (
    <Section id="effect" title="Effect">
      <Segmented
        grid
        value={choice}
        options={[
          { value: "rain", label: "Rain" },
          { value: "snow", label: "Snow" },
          { value: "stars", label: "Stars" },
          { value: "clouds", label: "Clouds", title: "Puffy clouds drifting with the wind" },
          { value: "overcast", label: "Overcast", title: "A low grey sky rolling past" },
          { value: "data", label: "From data", title: "Follow a binding, e.g. the weather" },
        ]}
        onChange={(v) => edit((x) => (x.effect = v === "data" ? "{{weather.effect}}" : v))}
      />
      {bound && (
        <>
          <BindingField kind="text" value={el.effect} placeholder="Pick a field…" onChange={(v) => edit((x) => (x.effect = v))} />
          <Note tone={now ? "info" : "muted"}>
            {now ? (
              <>
                Showing <b>{now}</b> right now.
              </>
            ) : (
              "Nothing right now: the binding isn't one of the effects."
            )}{" "}
            <span className="dim">{"{{weather.effect}}"} is rain or snow when it's falling, stars on a clear night, clouds when it's partly cloudy, overcast when it's overcast or foggy, none otherwise.</span>
          </Note>
        </>
      )}
      <label className="field">
        <span className="field-label">
          Density <span className="dim mono">{el.density}</span>
        </span>
        <input type="range" min={0} max={100} value={el.density} onChange={(e) => edit((x) => (x.density = Number(e.target.value)), `fx-density-${el.id}`)} />
      </label>
      <label className="field">
        <span className="field-label">
          Wind <span className="dim mono">{el.wind > 0 ? `${el.wind} →` : el.wind < 0 ? `← ${-el.wind}` : "none"}</span>
        </span>
        <input type="range" min={-100} max={100} value={el.wind} onChange={(e) => edit((x) => (x.wind = Number(e.target.value)), `fx-wind-${el.id}`)} />
      </label>
      <div className="field-stack">
        <NumberField label="Speed" suffix="×" step={0.25} min={0.25} max={4} value={el.speed} onChange={(v) => edit((x) => (x.speed = v), `fx-speed-${el.id}`)} />
        <NumberField label="Size" min={1} max={3} value={el.size} onChange={(v) => edit((x) => (x.size = Math.round(v)), `fx-size-${el.id}`)} />
      </div>
      <div className="row gap wrap">
        <button className="btn small" title="Each showing of the slide already gets its own arrangement; this picks a different set of them" onClick={() => edit((x) => (x.seed = Math.floor(Math.random() * 1e6)))}>
          Shuffle
        </button>
        <label className="check" title="Draw every particle in the element's colour instead of the effect's own">
          <input type="checkbox" checked={el.tint} onChange={(e) => edit((x) => (x.tint = e.target.checked))} /> Use colour
        </label>
      </div>
      <label className="field">
        <span className="field-label">Motion</span>
        <Segmented
          value={String(el.stepMs)}
          options={[
            { value: "0", label: "Smooth", title: "Move every frame" },
            { value: "100", label: "10/s", title: "Move ten times a second" },
            { value: "200", label: "5/s", title: "Move five times a second" },
          ]}
          onChange={(v) => edit((x) => (x.stepMs = Number(v)))}
        />
      </label>
      <Note tone="muted">Particles change every frame, which makes slides bigger for the device; hover ▶ on the slide to check its size. A lower motion rate or density keeps it small.</Note>
    </Section>
  );
}
