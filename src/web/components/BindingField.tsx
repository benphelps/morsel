import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { bindingsIn, type Scope } from "../../shared/bindings";
import { bindingRows, groupRows, preview, type BindingGroup, type BindingKind, type BindingRow } from "../bindingRows";
import { scopeAt, useStore } from "../store";
import { Icon } from "./Icon";

export type { BindingKind } from "../bindingRows";

// Picking data for a {{binding}}: one list, the same everywhere, of the fields
// in the data right now with what each holds. The rotator's item comes first
// (in its own colour), then notification fields, then each data source, each
// folding away; typing filters it.

/** A binding's path, with its group's name dimmed so the field stands out. */
function BindingPath({ group, path }: { group: string; path: string }) {
  if (path.startsWith(`${group}.`))
    return (
      <span className="mono">
        <span className="dim">{group}.</span>
        {path.slice(group.length + 1)}
      </span>
    );
  return <span className="mono">{path}</span>;
}

const GROUP_ROWS = 60;

/**
 * The folding groups of a list: which are open (at first `startOpen`, or the
 * only group; while searching, all of them), toggling one, and the rows
 * showing, in order, for moving through with the arrow keys.
 */
function useGroups(groups: BindingGroup[], needle: string, startOpen: string[]) {
  const [expanded, setExpanded] = useState<string[] | null>(null);
  const current = expanded ?? startOpen;
  const isOpen = (id: string) => !!needle || groups.length === 1 || current.includes(id);
  const toggle = (id: string) => setExpanded(isOpen(id) ? current.filter((x) => x !== id) : [...current, id]);
  const visible = groups.filter((g) => isOpen(g.id)).flatMap((g) => g.rows.slice(0, GROUP_ROWS));
  return { isOpen, toggle, visible, reset: () => setExpanded(null) };
}

function filterGroups(groups: BindingGroup[], needle: string) {
  if (!needle) return groups;
  const n = needle.toLowerCase();
  return groups.map((g) => ({ ...g, rows: g.rows.filter((r) => r.path.toLowerCase().includes(n)) })).filter((g) => g.rows.length);
}

/** The list itself: a header per group (fold it with a click), then its rows. */
function BindingList({
  groups,
  isOpen,
  toggle,
  needle,
  active,
  current,
  onPick,
  empty,
}: {
  groups: BindingGroup[];
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  needle: string;
  active?: string | null;
  current?: string | null;
  onPick: (path: string) => void;
  empty: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the row picked with the arrow keys in view.
  useEffect(() => {
    if (active) ref.current?.querySelector(`[data-path="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <div className="popover-list" ref={ref}>
      {groups.map((g) => (
        <div key={g.id} className={`pop-section ${g.id === "item" ? "item" : ""} ${isOpen(g.id) ? "open" : ""}`}>
          <button className="pop-group" aria-expanded={isOpen(g.id)} onMouseDown={(e) => e.preventDefault()} onClick={() => !needle && toggle(g.id)}>
            <Icon name="chevron" size={10} className="pop-caret" />
            <span className="grow">{g.id}</span>
            <span className="pop-count">{g.rows.length}</span>
          </button>
          {isOpen(g.id) && (
            <>
              {g.rows.slice(0, GROUP_ROWS).map((r) => (
                <button
                  key={r.path}
                  data-path={r.path}
                  className={`pop-item ${r.path === active ? "active" : ""} ${r.path === current ? "current" : ""}`}
                  onMouseDown={(e) => e.preventDefault()} // keep the input focused
                  onClick={() => onPick(r.path)}
                >
                  <BindingPath group={g.id} path={r.path} />
                  <span className="dim trunc">{preview(r.value)}</span>
                </button>
              ))}
              {g.rows.length > GROUP_ROWS && <div className="dim small pad">{g.rows.length - GROUP_ROWS} more; search to find them.</div>}
            </>
          )}
        </div>
      ))}
      {!groups.length && <div className="dim pad">{empty}</div>}
    </div>
  );
}

/** Arrow keys move through the rows showing, Enter picks, Escape closes. Returns true if it used the key. */
function listKeys(e: KeyboardEvent, visible: BindingRow[], active: string | null, setActive: (p: string | null) => void, pick: (p: string) => void, close: () => void) {
  const i = visible.findIndex((r) => r.path === active);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = visible[e.key === "ArrowDown" ? Math.min(visible.length - 1, i + 1) : Math.max(0, i - 1)];
    if (next) setActive(next.path);
    return true;
  }
  if (e.key === "Enter" && active && i >= 0) {
    e.preventDefault();
    pick(active);
    return true;
  }
  if (e.key === "Escape") {
    close();
    return true;
  }
  return false;
}

/** "!{{a.b|round}}" → its path (a.b), filters and "!", if the text is just one binding; otherwise null. */
function parseBinding(text: string) {
  const t = text.trim();
  const negate = t.startsWith("!");
  const refs = bindingsIn(t);
  const whole = refs.length === 1 && refs[0].start === (negate ? t.indexOf("{{") : 0) && refs[0].end === t.length && (!negate || t.slice(1, refs[0].start).trim() === "");
  return { negate, path: whole ? refs[0].path : null };
}

/** Closes when something outside all of `refs` (the field, and its floating list) is pressed. */
function useOutside(refs: React.RefObject<HTMLElement | null>[], open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !refs.some((r) => r.current?.contains(e.target as Node)) && close();
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open, refs, close]);
}

/**
 * The list, floating over the panel rather than pushing what's below it down:
 * drawn above everything (so a scrolling panel can't clip it), under `anchor`,
 * or over it where there's more room above. As wide as the anchor, or with
 * `wide`, as the inspector. It follows the anchor as the panel scrolls.
 */
function Floating({ anchor, wide, panelRef, children }: { anchor: HTMLElement | null; wide?: boolean; panelRef: React.RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const panel = wide ? anchor.closest(".inspector")?.getBoundingClientRect() : null;
      const [left, width] = panel ? [panel.left + 12, panel.width - 24] : [a.left, a.width];
      const h = panelRef.current?.offsetHeight ?? 0;
      const below = window.innerHeight - a.bottom - 8;
      const above = a.top - 8;
      setPos(h > below && above > below ? { left, width, bottom: window.innerHeight - a.top + 4, maxHeight: above } : { left, width, top: a.bottom + 4, maxHeight: below });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const ro = new ResizeObserver(place);
    if (panelRef.current) ro.observe(panelRef.current);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      ro.disconnect();
    };
  }, [anchor, wide, panelRef]);
  return createPortal(
    <div className="popover floating" ref={panelRef} style={{ ...pos, visibility: pos ? undefined : "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}

/**
 * A {{binding}} to data, chosen from what's there now. "pick" chooses one field
 * from the list (searchable); "type" is a text box, for values that can also be
 * written out (a number, a "!" to invert), that suggests fields as you type.
 * Either way the list floats over the panel, below it.
 */
export function BindingField({
  value,
  onChange,
  kind,
  mode = "pick",
  placeholder,
  none,
  scope: given,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  kind: BindingKind;
  mode?: "pick" | "type";
  placeholder?: string;
  /** Pick: offer clearing it, labelled this (e.g. "Uploaded image"). */
  none?: string;
  /** The data to choose from; the editor's at this level unless given. */
  scope?: Scope;
  className?: string;
}) {
  useStore((s) => s.sourceStatus); // the values follow the data
  const scope = given ?? scopeAt(Date.now());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const refs = useRef([ref, listRef]).current;
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  useOutside(refs, open, close);

  const rows = bindingRows(scope, kind);
  const all = groupRows(rows, scope);
  const { negate, path } = parseBinding(value);
  const known = path != null && rows.some((r) => r.path === path) ? path : null;
  // Typing filters the list: in "pick" its search box; in "type" what's typed, unless it's already a field (then all, to browse).
  const typed = value.replace(/[{}!]/g, "").split("|")[0].trim();
  const needle = mode === "pick" ? query.trim() : known ? "" : typed;
  const groups = filterGroups(all, needle);
  const startOpen = known ? [all.find((g) => g.rows.some((r) => r.path === known))!.id] : "item" in scope ? ["item"] : [];
  const fold = useGroups(groups, needle, startOpen);

  const pick = (p: string) => {
    onChange(mode === "type" && negate ? `!{{${p}}}` : `{{${p}}}`);
    close();
    fold.reset();
  };
  const openList = () => {
    fold.reset();
    setActive(known ?? null);
    setOpen(true);
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation(); // not the editor's shortcuts
    if (!open) {
      if (e.key === "ArrowDown") openList();
      return;
    }
    listKeys(e, fold.visible, active, setActive, pick, close);
  };
  const empty = needle ? "Nothing matches." : kind === "number" ? "No numbers in your data right now." : kind === "list" ? "No lists in your data right now." : "Nothing in your data right now.";

  return (
    <div className={`bfield ${open ? "open" : ""} ${className}`} ref={ref}>
      {mode === "pick" ? (
        <button className="bfield-trigger" onClick={() => (open ? close() : openList())} onKeyDown={onKey}>
          {known ? (
            <>
              <BindingPath group={all.find((g) => g.rows.some((r) => r.path === known))!.id} path={known} />
              <span className="dim trunc">{preview(rows.find((r) => r.path === known)!.value)}</span>
            </>
          ) : value.trim() ? (
            <span className="mono trunc" title="Not in the data right now">
              {value}
            </span>
          ) : (
            <span className="dim">{none ?? placeholder ?? "Pick…"}</span>
          )}
          <Icon name="chevron" size={11} className="bfield-caret" />
        </button>
      ) : (
        <input
          className="mono"
          value={value}
          placeholder={placeholder}
          onFocus={openList}
          onClick={() => !open && openList()}
          onKeyDown={onKey}
          onChange={(e) => {
            onChange(e.target.value);
            if (!open) setOpen(true);
            setActive(null);
          }}
        />
      )}
      {open && (
        <Floating anchor={ref.current} panelRef={listRef}>
          {mode === "pick" && (
            <input
              autoFocus
              placeholder="Search fields…"
              value={query}
              onKeyDown={onKey}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(null);
              }}
            />
          )}
          {mode === "pick" && none && !needle && (
            <button className={`pop-item none ${value.trim() ? "" : "current"}`} onClick={() => (onChange(""), close())}>
              <span>{none}</span>
            </button>
          )}
          <BindingList groups={groups} isOpen={fold.isOpen} toggle={fold.toggle} needle={needle} active={active} current={known} onPick={pick} empty={empty} />
        </Floating>
      )}
    </div>
  );
}

/**
 * "{ } Insert data": every field in the data, to insert into text. It opens on
 * the groups `text` already uses (else, in a rotator, the item).
 */
export function BindingPicker({ text = "", compact = false, onPick }: { text?: string; /** A small { } icon (e.g. in a section's title row) rather than a button. */ compact?: boolean; onPick: (binding: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const project = useStore((s) => s.project);
  useStore((s) => s.plugins);
  useStore((s) => s.sourceStatus); // values follow the data
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const refs = useRef([ref, listRef]).current;
  const close = () => {
    setOpen(false);
    setQ("");
  };
  useOutside(refs, open, close);
  const scope = scopeAt(Date.now());
  const all = groupRows(bindingRows(scope, "text"), scope);
  const needle = q.trim();
  const groups = filterGroups(all, needle);
  const ids = new Set(all.map((g) => g.id));
  // Where each binding in the text comes from; the rotator's index and count are with the item.
  const used = [...new Set(bindingsIn(text).map((b) => b.path.split(".")[0]).map((root) => (ids.has("item") && (root === "index" || root === "count") ? "item" : root)))].filter((id) => ids.has(id));
  const fold = useGroups(groups, needle, used.length ? used : ids.has("item") ? ["item"] : []);
  if (!project) return null;
  const pick = (p: string) => {
    onPick(`{{${p}}}`);
    close();
    fold.reset();
  };
  return (
    <div className="binding-picker" ref={ref}>
      <button
        className={compact ? `fold-action ${open ? "on" : ""}` : "btn small"}
        title={compact ? "Insert data: a field from your data sources" : undefined}
        aria-label={compact ? "Insert data" : undefined}
        onClick={() => {
          if (open) return close();
          fold.reset();
          setActive(null);
          setOpen(true);
        }}
      >
        {compact ? <Icon name="braces" size={14} /> : <>{"{ }"} Insert data</>}
      </button>
      {open && (
        <Floating anchor={ref.current} wide panelRef={listRef}>
          <input
            autoFocus
            placeholder="Search fields…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              listKeys(e, fold.visible, active, setActive, pick, close);
            }}
          />
          <BindingList groups={groups} isOpen={fold.isOpen} toggle={fold.toggle} needle={needle} active={active} onPick={pick} empty={needle ? "No fields match." : "No data sources yet. Add one under Data."} />
          <div className="pop-foot dim">
            Filters: <span className="mono">|round</span> <span className="mono">|upper</span> <span className="mono">|pad:2</span> <span className="mono">|trunc:12</span> <span className="mono">|fixed:1</span>
          </div>
        </Floating>
      )}
    </div>
  );
}
