import { useEffect, useRef, useState, type ReactNode } from "react";
import { getIcon, ICONS } from "../../shared/icons";
import { icon2xAt } from "../../shared/icons2x";
import { Icon } from "./Icon";

const FOLD_KEY = (id: string) => `morsel.fold.${id}`;

/**
 * An inspector section that folds away to its title, with a one-line summary
 * of what's set, so the panel starts short and only what's being worked on is
 * open. Each remembers being open or closed (in this browser, by id).
 */
export function Section({
  id,
  title,
  summary,
  defaultOpen = true,
  className = "",
  actions,
  children,
}: {
  id: string;
  title: ReactNode;
  /** Shown beside the title while folded. */
  summary?: ReactNode;
  /** Small buttons on the right of the title while open (see .fold-action). */
  actions?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(FOLD_KEY(id));
      return v == null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(FOLD_KEY(id), open ? "0" : "1");
    } catch {
      /* not kept: fine */
    }
  };
  return (
    <section className={`fold ${open ? "open" : ""} ${className}`}>
      <div className="fold-bar">
        <button className="fold-head" onClick={toggle} aria-expanded={open}>
          <Icon name="chevron" size={11} className="fold-caret" />
          <span className="fold-title">{title}</span>
          {!open && summary != null && summary !== "" && <span className="fold-summary">{summary}</span>}
        </button>
        {open && actions && <div className="fold-actions">{actions}</div>}
      </div>
      {open && children}
    </section>
  );
}

/** Number input whose label can be dragged left/right to scrub the value. */
export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  keyed,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  keyed?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const scrub = useRef<{ x: number; v: number } | null>(null);
  const shown = draft ?? String(Math.round(value * 1000) / 1000);
  return (
    <label className={`num-field ${keyed ? "keyed" : ""}`}>
      <span
        className="num-label"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          scrub.current = { x: e.clientX, v: value };
        }}
        onPointerMove={(e) => {
          if (!scrub.current) return;
          const delta = Math.round((e.clientX - scrub.current.x) / 4) * step;
          onChange(clamp(Math.round((scrub.current.v + delta) / step) * step));
        }}
        onPointerUp={() => (scrub.current = null)}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft.trim() !== "" && Number.isFinite(Number(draft))) onChange(clamp(Number(draft)));
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(clamp(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
          }
          e.stopPropagation();
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </label>
  );
}

export const SWATCHES = ["#ffffff", "#aab6c4", "#6c7a8a", "#ff4040", "#ff8a1f", "#ffc21a", "#fff27a", "#32d46a", "#2ee6c5", "#3aa0ff", "#5b5bff", "#a67cff", "#ff6fb5", "#000000"];

export function ColorField({ label, value, onChange, keyed }: { label: string; value: string; onChange: (v: string) => void; keyed?: boolean }) {
  return (
    <div className={`color-field ${keyed ? "keyed" : ""}`}>
      {label && <span className="field-label">{label}</span>}
      <div className="swatches">
        {/* Custom colour: a rainbow ring around the current colour, lit when it isn't a preset. */}
        <label
          className={`swatch custom ${SWATCHES.includes(value.toLowerCase()) ? "" : "on"}`}
          style={{ "--c": value } as React.CSSProperties}
          title={`Custom colour… (${value})`}
        >
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        </label>
        {SWATCHES.map((c) => (
          <button key={c} className={`swatch ${c === value.toLowerCase() ? "on" : ""}`} style={{ background: c }} title={c} onClick={() => onChange(c)} />
        ))}
      </div>
    </div>
  );
}

/** Buttons picking one of a few values; `grid` lays more than fit on a line out three to a row. Labels can be text or an <Icon>; give icon-only ones a title. */
export function Segmented<T extends string>({ value, options, onChange, grid }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; grid?: boolean }) {
  return (
    <div className={grid ? "segmented grid" : "segmented"}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : ""} title={o.title} aria-label={typeof o.label === "string" ? undefined : o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A slim callout with context about the current settings (what they'll do, or
 * why they won't). "ok" confirms something is working; "warn" flags something
 * that won't work as expected; "muted" is for a side remark or help text.
 */
export function Note({ tone = "info", children }: { tone?: "info" | "ok" | "warn" | "muted"; children: ReactNode }) {
  return (
    <div className={`note note-${tone}`} role="note">
      {children}
    </div>
  );
}

/**
 * An "i" button that shows reference detail in a popover, keeping it out of the
 * panel's flow. The popover hangs from the nearest positioned ancestor (e.g. the
 * inspector header). It shows while the button or popover is hovered; a click
 * keeps it open until an outside click or Escape.
 */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const ref = useRef<HTMLDivElement>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = () => {
    setHover(false);
    setPinned(false);
  };
  useEffect(() => () => void (leave.current && clearTimeout(leave.current)), []);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // don't also deselect in the editor
      close();
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <div
      className="info-pop"
      ref={ref}
      onMouseEnter={() => {
        if (leave.current) clearTimeout(leave.current);
        setHover(true);
      }}
      // A moment's grace, so crossing the gap to the panel doesn't close it.
      onMouseLeave={() => (leave.current = setTimeout(() => setHover(false), 150))}
    >
      <button className={`info-btn ${open ? "on" : ""}`} aria-label={label} aria-expanded={open} onClick={() => setPinned((p) => !p)}>
        i
      </button>
      {open && (
        <div className="info-pop-panel" role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

/** One "label … value" line inside a Note. */
export function NoteRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="note-row">
      <span>{label}</span>
      <span className="note-value">{value}</span>
    </div>
  );
}

export function IconPreview({ name, scale = 2, hires = false }: { name: string; scale?: number; hires?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Same on-screen size either way: the 1× art at `scale`, or the 2× art at half that.
  // As it looks today: the moon icons show its phase.
  const icon = hires ? icon2xAt(name) : getIcon(name);
  if (hires) scale = Math.max(1, scale / 2);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !icon) return;
    ctx.clearRect(0, 0, 999, 999);
    icon.px.forEach((c, i) => {
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect((i % icon.w) * scale, Math.floor(i / icon.w) * scale, scale, scale);
    });
  }, [name, scale, icon]);
  if (!icon) return null;
  return <canvas ref={ref} width={icon.w * scale} height={icon.h * scale} />;
}

export function IconGrid({ value, onPick, hires = false }: { value: string; onPick: (name: string) => void; hires?: boolean }) {
  return (
    <div className="icon-grid">
      {Object.keys(ICONS).map((name) => (
        <button key={name} className={`icon-cell ${name === value ? "on" : ""}`} title={name} onClick={() => onPick(name)}>
          <IconPreview name={name} hires={hires} />
        </button>
      ))}
    </div>
  );
}
