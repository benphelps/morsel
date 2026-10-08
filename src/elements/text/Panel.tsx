import { useEffect, useRef } from "react";
import { resolveKeys, type Clock } from "../../shared/animate";
import { bindingsIn, lookup, resolveTemplate } from "../../shared/bindings";
import { getFont, listFonts } from "../../shared/fonts";
import { numberFormatSummary, NumberFormatSection } from "./Format";
import { Icon } from "../../web/components/Icon";
import { Note, NoteRow, NumberField, Section, Segmented } from "../../web/components/Fields";
import { BindingPicker } from "../../web/components/BindingField";
import { setEverywhere } from "../../web/model";
import { scopeAt } from "../../web/store";
import type { PanelProps } from "../types";
import {
  growTextToFit,
  DEFAULT_MAX_SPEED,
  fillFinishMs,
  onceEndMs,
  onceSpeed,
  restMs,
  marqueeTiming,
  movingSpans,
  pingPongCycleMs,
  scrollExtent,
  slideTimeAt,
  textBoxSize,
  type TextElement,
} from "./element";

/** `heading` names the first section, for panels that reuse this one. */
export function TextPanel({ el, clock, edit, heading = "Text" }: PanelProps<TextElement> & { heading?: string }) {
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Double-click on the canvas, or Enter, jumps to the text.
  useEffect(() => {
    const focus = () => textRef.current?.focus();
    window.addEventListener("morsel:edit-element", focus);
    return () => window.removeEventListener("morsel:edit-element", focus);
  }, []);

  const scope = scopeAt(Date.now());
  // Characters this font can't draw (a € typed as a prefix, say).
  const font = getFont(el.font);
  const missing = [...new Set([...resolveTemplate(el.text, scope)].filter((c) => c.trim() && !font.glyph(c.codePointAt(0)!)))];

  /** After a font or scale change: fit the height, and grow to fit unbound text. */
  const refit = (x: TextElement) => {
    setEverywhere(x, { h: textBoxSize(x, scopeAt(Date.now())).h });
    growTextToFit(x, scopeAt(Date.now()));
  };

  // Number formatting only comes up for text with a number in it.
  const numeric = bindingsIn(el.text).some((r) => typeof lookup(scope, r.path) === "number");
  const shown = resolveTemplate(el.text, scope).replace(/\s+/g, " ").trim();
  const up = el.marqueeDirection === "up";
  const MODES = { loop: "loop", once: "once", pingpong: "ping-pong" };
  const overflowSummary =
    el.overflow === "clip" ? "Clip" : el.overflow === "wrap" ? `Wrap${el.wrapMode === "char" ? " anywhere" : ""}` : `Scroll ${up ? "up" : "sideways"}, ${MODES[el.marqueeMode ?? "loop"]}`;

  return (
    <>
      <Section
        id="text"
        title={heading}
        summary={shown}
        actions={
          <>
            <BindingPicker
              compact
              text={el.text}
              onPick={(b) => {
                const ta = textRef.current;
                const at = ta ? ta.selectionStart : el.text.length;
                edit((x) => (x.text = x.text.slice(0, at) + b + x.text.slice(ta ? ta.selectionEnd : at)));
              }}
            />
            <button className="fold-action" title="Fit box: size the box to the text as it renders right now" aria-label="Fit box" onClick={() => edit((x) => setEverywhere(x, textBoxSize(x, scopeAt(Date.now()))))}>
              <Icon name="fitBox" size={14} />
            </button>
          </>
        }
      >
        <textarea
          ref={textRef}
          rows={2}
          value={el.text}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) =>
            edit((x) => {
              x.text = e.target.value;
              growTextToFit(x, scopeAt(Date.now()));
            }, `text-${el.id}`)
          }
        />
        {missing.length > 0 && (
          <Note tone="warn">
            {getFont(el.font).label} has no {missing.map((c) => `“${c}”`).join(" ")}, so {missing.length === 1 ? "it won't" : "they won't"} show.
          </Note>
        )}
      </Section>

      {numeric && (
        <Section id="text-number" title="Number format" summary={numberFormatSummary(el.text, scope)} defaultOpen={false}>
          <NumberFormatSection
            text={el.text}
            scope={scope}
            onText={(text, coalesce) =>
              edit((x) => {
                x.text = text;
                growTextToFit(x, scopeAt(Date.now()));
              }, coalesce && `${coalesce}-${el.id}`)
            }
          />
        </Section>
      )}

      <Section id="text-font" title="Font" summary={`${font.label} · ${el.scale ?? 1}× · ${el.align}`}>
        <div className="font-row">
          <label className="field">
            <span className="field-label">Font</span>
            <select
              value={el.font}
              onChange={(e) =>
                edit((x) => {
                  x.font = e.target.value;
                  refit(x);
                })
              }
            >
              {listFonts().map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label} · {f.lineHeight}px
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label" title="Draw each font pixel as a 2×2, 3×3 or 4×4 block">
              Scale
            </span>
            <select
              value={el.scale ?? 1}
              onChange={(e) =>
                edit((x) => {
                  x.scale = Number(e.target.value);
                  refit(x);
                })
              }
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row gap wrap">
          <Segmented
            value={el.align}
            options={[
              { value: "left", label: <Icon name="alignLeft" />, title: "Left" },
              { value: "center", label: <Icon name="alignCenter" />, title: "Centre" },
              { value: "right", label: <Icon name="alignRight" />, title: "Right" },
            ]}
            onChange={(v) => edit((x) => (x.align = v))}
          />
          <Segmented
            value={el.valign}
            options={[
              { value: "top", label: <Icon name="alignTop" />, title: "Top" },
              { value: "middle", label: <Icon name="alignMiddle" />, title: "Middle" },
              { value: "bottom", label: <Icon name="alignBottom" />, title: "Bottom" },
            ]}
            onChange={(v) => edit((x) => (x.valign = v))}
          />
        </div>
      </Section>

      <Section id="text-overflow" title="Overflow" summary={overflowSummary}>
        <Segmented
          value={el.overflow}
          options={[
            { value: "clip", label: "Clip", title: "Cut off text that doesn't fit" },
            { value: "wrap", label: "Wrap", title: "Break lines to fit the box width" },
            { value: "marquee", label: "Scroll", title: "Scroll text that doesn't fit its box" },
          ]}
          onChange={(v) => edit((x) => (x.overflow = v))}
        />
        {el.overflow === "marquee" && <MarqueeOptions clock={clock} el={el} edit={edit} />}
        {el.overflow === "wrap" && <LineBreaks el={el} edit={edit} />}
        <NumberField label="Line gap" min={0} max={10} value={el.lineSpacing} onChange={(v) => edit((x) => (x.lineSpacing = v), `ls-${el.id}`)} />
      </Section>
    </>
  );
}

/** Where wrapped lines break: for wrapping text, and text rolling up (which wraps too). */
function LineBreaks({ el, edit }: { el: TextElement; edit: PanelProps<TextElement>["edit"] }) {
  return (
    <label className="field">
      <span className="field-label">Line breaks</span>
      <Segmented
        value={el.wrapMode ?? "word"}
        options={[
          { value: "word", label: "Between words", title: "Break lines between words" },
          { value: "char", label: "Anywhere", title: "Fill each line to the edge, breaking mid-word" },
        ]}
        onChange={(v) => edit((x) => (x.wrapMode = v))}
      />
    </label>
  );
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * How text scrolls. A "once" scroll's pace follows its timeline: in a Hold (a
 * fitted slide or rotator item) it goes at its speed and the Hold lasts as long
 * as it takes; on a fixed-length timeline it goes at its speed, or fills the
 * time up to the outro line.
 */
function MarqueeOptions({ clock, el, edit }: { clock: Clock; el: TextElement; edit: PanelProps<TextElement>["edit"] }) {
  const end = clock.end;
  const inHold = !!clock.hold;
  const mode = el.marqueeMode ?? "loop";
  const timing = marqueeTiming(el);
  // Timings are measured with every key at its time on this timeline.
  const resolved = resolveKeys(el, end);
  // Along the scroll: the widest line and the box's width, or scrolling up, the text's height and the box's.
  const { content: widest, box } = scrollExtent(resolved, scopeAt(Date.now()));
  // All in slide time, so they line up with the timeline.
  const startsMs = slideTimeAt(resolved, timing.startMs);
  const endMs = slideTimeAt(resolved, onceEndMs(resolved, widest, box, clock));
  // Filling the time: when it's meant to finish, and whether this text needs to go faster than the cap.
  const fill = mode === "once" && !inHold && !!el.marqueeFill;
  const target = fill ? fillFinishMs(resolved, clock) : null;
  const plannedMs = target != null ? slideTimeAt(resolved, target) : endMs;
  const capped = fill && endMs > plannedMs + 1;
  const rest = restMs(el);
  const roundTripMs = slideTimeAt(resolved, pingPongCycleMs(widest, box, el.marqueeSpeed, timing));
  const animated = movingSpans(resolved).length > 0;
  const finishMs = mode === "once" ? endMs : mode === "pingpong" ? roundTripMs : startsMs;
  const late = finishMs > end;
  const up = el.marqueeDirection === "up";
  const lineH = getFont(el.font).lineHeight * (el.scale ?? 1);
  return (
    <>
      <Segmented
        value={up ? "up" : "left"}
        options={[
          { value: "left", label: "Sideways", title: "Each line scrolls left, on one line" },
          { value: "up", label: "Up", title: "Like film credits: the text wraps to the box's width and rolls up" },
        ]}
        onChange={(v) =>
          edit((x) => {
            if (v === "up") {
              x.marqueeDirection = "up";
              if (x.marqueeSpeed === 20) x.marqueeSpeed = 10; // reading speed for lines going by
            } else delete x.marqueeDirection;
          })
        }
      />
      {up && el.state.h < lineH * 2 && <Note tone="warn">Make the box taller: it rolls the text through its height, and it's only a line high.</Note>}
      {up && <LineBreaks el={el} edit={edit} />}
      <Segmented
        value={mode}
        options={[
          { value: "loop", label: "Loop", title: "Keep scrolling, wrapping around" },
          { value: "once", label: "Once", title: up ? "Roll until the last line reaches the bottom of the box, then hold" : "Scroll until the end of the text reaches the right edge, then hold" },
          { value: "pingpong", label: "Ping-pong", title: "Scroll to the end, pause, scroll back, pause, repeat" },
        ]}
        onChange={(v) => edit((x) => (x.marqueeMode = v))}
      />
      {mode === "once" && !inHold && (
        <Segmented
          value={fill ? "fill" : "speed"}
          options={[
            { value: "speed", label: "Speed", title: "Scroll at a set speed: longer text takes longer" },
            { value: "fill", label: "Fill the time", title: `Take the whole time there is: finish, then rest, by ${clock.outroMs ? "the outro line" : "the end"}. Longer text goes faster.` },
          ]}
          onChange={(v) =>
            edit((x) => {
              if (v === "fill") x.marqueeFill = true;
              else delete x.marqueeFill;
            })
          }
        />
      )}
      <div className="field-stack">
        {fill ? (
          <NumberField label="Max speed" suffix="px/s" min={1} max={200} value={el.marqueeMaxSpeed ?? DEFAULT_MAX_SPEED} onChange={(v) => edit((x) => (x.marqueeMaxSpeed = v), `mq-max-${el.id}`)} />
        ) : (
          <NumberField label="Speed" suffix="px/s" min={1} max={200} value={el.marqueeSpeed} onChange={(v) => edit((x) => (x.marqueeSpeed = v), `mq-${el.id}`)} />
        )}
        <NumberField label="Start after" suffix="ms" step={100} min={0} max={30000} value={timing.startMs} onChange={(v) => edit((x) => (x.marqueeDelayMs = v), `mq-delay-${el.id}`)} />
        {mode === "once" ? (
          <NumberField label="Rest after" suffix="ms" step={100} min={0} max={30000} value={rest} onChange={(v) => edit((x) => (x.marqueeRestMs = Math.max(0, Math.round(v))), `mq-rest-${el.id}`)} />
        ) : (
          <NumberField
            label={mode === "pingpong" ? "Pause at ends" : "Pause each loop"}
            suffix="ms"
            step={100}
            min={0}
            max={30000}
            value={timing.pauseMs}
            onChange={(v) => edit((x) => (x.marqueePauseMs = v), `mq-pause-${el.id}`)}
          />
        )}
      </div>
      {inHold ? (
        <Note tone="muted">
          {mode === "once"
            ? "Scrolls in the Hold, from “Start after”, at its speed, then rests. The Hold lasts as long as that takes (at least its “Hold at least”)."
            : "Scrolls during the Hold: “Start after” counts from when it begins."}
        </Note>
      ) : (
        <>
          <label className="check" title="Keyframed moves (an intro or exit) pause the scroll and don't count towards the start delay">
            <input type="checkbox" checked={!!el.marqueeHoldWhileMoving} onChange={(e) => edit((x) => (x.marqueeHoldWhileMoving = e.target.checked))} /> Wait while animating
          </label>
          {el.marqueeHoldWhileMoving && !animated && <Note tone="muted">This element has no keyframed moves, so there's nothing to wait for.</Note>}
          {widest <= box ? (
            <Note tone="muted">The text fits in its box right now, so it won't scroll.</Note>
          ) : (
            <Note tone={late || capped ? "warn" : "info"}>
              <NoteRow label="Starts scrolling" value={secs(startsMs)} />
              {mode === "once" && <NoteRow label="Reaches the end" value={secs(endMs)} />}
              {fill && <NoteRow label="Speed for this text" value={`${Math.round(onceSpeed(resolved, widest, box, clock))} px/s`} />}
              {capped && <span>Too long to finish by {secs(plannedMs)} under the speed cap, so it scrolls at the cap and finishes late.</span>}
              {mode === "pingpong" && <NoteRow label="Back at the start" value={secs(roundTripMs)} />}
              {late && <span>That's after the end, at {secs(end)}.</span>}
            </Note>
          )}
        </>
      )}
    </>
  );
}
