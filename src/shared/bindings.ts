export type Scope = Record<string, unknown>;

const BINDING = /\{\{\s*([^}]+?)\s*\}\}/g;

export function hasBindings(text: string): boolean {
  BINDING.lastIndex = 0;
  return BINDING.test(text);
}

/** Looks up "a.b.0.c" or "a.b[0].c" in the scope. */
export function lookup(scope: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = scope;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

type Filter = (v: unknown, ...args: string[]) => unknown;

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

export const FILTERS: Record<string, Filter> = {
  round: (v, d = "0") => (Number.isFinite(num(v)) ? num(v).toFixed(Number(d)) : v),
  fixed: (v, d = "1") => (Number.isFinite(num(v)) ? num(v).toFixed(Number(d)) : v),
  floor: (v) => (Number.isFinite(num(v)) ? Math.floor(num(v)) : v),
  ceil: (v) => (Number.isFinite(num(v)) ? Math.ceil(num(v)) : v),
  abs: (v) => (Number.isFinite(num(v)) ? Math.abs(num(v)) : v),
  sign: (v) => (Number.isFinite(num(v)) && num(v) > 0 ? `+${v}` : v),
  comma: (v) => (Number.isFinite(num(v)) ? num(v).toLocaleString("en-US") : v),
  upper: (v) => String(v).toUpperCase(),
  lower: (v) => String(v).toLowerCase(),
  title: (v) => String(v).replace(/\b\w/g, (c) => c.toUpperCase()),
  pad: (v, n = "2", ch = "0") => String(v).padStart(Number(n), ch),
  trunc: (v, n = "10") => {
    const s = String(v);
    return s.length > Number(n) ? s.slice(0, Math.max(0, Number(n) - 1)) + "…" : s;
  },
  num: (v, d = "", ...flags) => formatNumber(v, { ...parseNumFlags(flags), decimals: d === "" ? undefined : Number(d) }),
  default: (v, d = "") => (v == null || v === "" ? d : v),
  replace: (v, a = "", b = "") => String(v).split(a).join(b),
};

/* ---------------- number formatting ---------------- */

/**
 * How {{x|num:…}} shows a number: `num:<decimals>` and then any of `comma`
 * (thousands separators), `sign` (always a + or -), `pct` (a % after it),
 * `compact` (1.2K, 3.4M, 5.6B), `pre=$` and `suf=_USD` (_ for a space).
 */
export interface NumberFormat {
  /** Digits after the point; missing keeps the number as it comes (compact: 1). */
  decimals?: number;
  comma?: boolean;
  sign?: boolean;
  style?: "plain" | "pct" | "compact";
  prefix?: string;
  suffix?: string;
}

function parseNumFlags(flags: string[]): NumberFormat {
  const f: NumberFormat = { style: "plain" };
  for (const flag of flags) {
    if (flag === "comma") f.comma = true;
    else if (flag === "sign") f.sign = true;
    else if (flag === "pct" || flag === "compact") f.style = flag;
    else if (flag.startsWith("pre=")) f.prefix = flag.slice(4).replace(/_/g, " ");
    else if (flag.startsWith("suf=")) f.suffix = flag.slice(4).replace(/_/g, " ");
  }
  return f;
}

/** A `num:…` filter's settings (see NumberFormat); null if it isn't one. */
export function parseNumFilter(filter: string): NumberFormat | null {
  const [name, d = "", ...flags] = filter.split(":").map((x) => x.trim());
  if (name !== "num") return null;
  return { ...parseNumFlags(flags), decimals: d === "" ? undefined : Number(d) };
}

/** The `num:…` filter for these settings. Characters a binding can't hold (: | { }) are dropped. */
export function numFilter(f: NumberFormat): string {
  const clean = (x: string) => x.replace(/[:|{}]/g, "").replace(/ /g, "_");
  const parts = ["num", f.decimals == null ? "" : String(f.decimals)];
  if (f.comma) parts.push("comma");
  if (f.sign) parts.push("sign");
  if (f.style && f.style !== "plain") parts.push(f.style);
  if (f.prefix) parts.push(`pre=${clean(f.prefix)}`);
  if (f.suffix) parts.push(`suf=${clean(f.suffix)}`);
  return parts.join(":");
}

const UNITS: [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/** A number as text, per NumberFormat. The sign goes before any prefix (+$4.98), in plain ASCII. */
export function formatNumber(v: unknown, f: NumberFormat): unknown {
  const n = num(v);
  if (v === null || v === "" || !Number.isFinite(n)) return v;
  let abs = Math.abs(n);
  let unit = "";
  if (f.style === "compact") {
    const hit = UNITS.find(([size]) => abs >= size);
    if (hit) [abs, unit] = [abs / hit[0], hit[1]];
  }
  const digits = f.decimals ?? (f.style === "compact" && unit ? 1 : undefined);
  let body = digits == null ? String(abs) : abs.toFixed(Math.max(0, Math.min(10, digits)));
  if (f.comma) {
    const [whole, frac] = body.split(".");
    body = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac != null ? `.${frac}` : "");
  }
  // Rounded to nothing, there's no sign to show.
  const zero = Number(body.replace(/,/g, "")) === 0;
  const sign = zero ? "" : n < 0 ? "-" : f.sign ? "+" : "";
  return `${sign}${f.prefix ?? ""}${body}${unit}${f.style === "pct" ? "%" : ""}${f.suffix ?? ""}`;
}

/* ---------------- bindings in text ---------------- */

/** A {{binding}} in some text: where it is, its path and its filters. */
export interface BindingRef {
  start: number;
  end: number;
  path: string;
  filters: string[];
}

export function bindingsIn(text: string): BindingRef[] {
  const out: BindingRef[] = [];
  for (const m of text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    const [path, ...filters] = m[1].split("|").map((x) => x.trim());
    out.push({ start: m.index!, end: m.index! + m[0].length, path, filters });
  }
  return out;
}

/** The text with one binding swapped for this path and these filters. */
export function replaceBinding(text: string, ref: BindingRef, filters: string[]): string {
  return `${text.slice(0, ref.start)}{{${[ref.path, ...filters].join("|")}}}${text.slice(ref.end)}`;
}

/** Paths to every number in a value, for picking what drives a colour. */
export function numberPaths(value: unknown, prefix = "", depth = 4, out: string[] = []): string[] {
  if (typeof value === "number" && Number.isFinite(value)) out.push(prefix);
  else if (value && typeof value === "object" && !Array.isArray(value) && depth > 0)
    for (const [k, v] of Object.entries(value)) numberPaths(v, prefix ? `${prefix}.${k}` : k, depth - 1, out);
  return out;
}

function applyFilters(value: unknown, filters: string[]): unknown {
  let v = value;
  for (const f of filters) {
    const [name, ...args] = f.split(":").map((s) => s.trim());
    const fn = FILTERS[name];
    if (fn) v = fn(v, ...args);
  }
  return v;
}

function stringify(v: unknown): string {
  if (v == null) return "--";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Replaces every {{path|filter:arg}} in text with its value from scope. */
export function resolveTemplate(text: string, scope: Scope): string {
  if (!text.includes("{{")) return text;
  return text.replace(BINDING, (_, expr: string) => {
    const [path, ...filters] = expr.split("|").map((s) => s.trim());
    const raw = lookup(scope, path);
    const hasDefault = filters.some((f) => f.startsWith("default"));
    if (raw === undefined && !hasDefault) return "--";
    return stringify(applyFilters(raw, filters));
  });
}

/** Every leaf path in a value, for the editor's binding picker. */
export function flattenPaths(value: unknown, prefix: string, depth = 4, out: { path: string; value: unknown }[] = []) {
  if (value !== null && typeof value === "object" && depth > 0) {
    const entries = Array.isArray(value) ? value.slice(0, 5).map((v, i) => [String(i), v] as const) : Object.entries(value);
    for (const [k, v] of entries) flattenPaths(v, prefix ? `${prefix}.${k}` : k, depth - 1, out);
  } else {
    out.push({ path: prefix, value });
  }
  return out;
}

/** "{{a.b}}" → "a.b"; anything else unchanged. */
export function unwrap(expr: string): string {
  const m = expr.trim().match(/^\{\{\s*([^}|]+?)\s*\}\}$/);
  return m ? m[1] : expr.trim();
}

/**
 * A list of numbers from a binding to an array ({{stocks.GSPC.series}}) or a
 * literal like "3, 5, 4, 8".
 */
export function resolveSeries(expr: string, scope: Scope): number[] {
  const t = expr.trim();
  if (!t) return [];
  if (/^[-+\d.,\s]+$/.test(t)) return t.split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite);
  const v = lookup(scope, unwrap(t));
  // Skip gaps (null), which Number() would turn into a spike to zero.
  return Array.isArray(v) ? v.filter((x) => x != null && x !== "").map(Number).filter(Number.isFinite) : [];
}

/** A single number from a binding ({{stocks.GSPC.prevClose}}) or a literal. */
export function resolveNumber(expr: string, scope: Scope): number | null {
  const t = expr.trim();
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n)) return n;
  const v = Number(lookup(scope, unwrap(t)));
  return Number.isFinite(v) ? v : null;
}

/** Paths to every array of at least two numbers, for picking sparkline data. */
export function numericSeriesPaths(value: unknown, prefix = "", depth = 5, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    if (value.filter((x) => typeof x === "number" && Number.isFinite(x)).length >= 2) out.push(prefix);
    else if (depth > 0) value.slice(0, 5).forEach((v, i) => numericSeriesPaths(v, `${prefix}.${i}`, depth - 1, out));
  } else if (value && typeof value === "object" && depth > 0) {
    for (const [k, v] of Object.entries(value)) numericSeriesPaths(v, prefix ? `${prefix}.${k}` : k, depth - 1, out);
  }
  return out;
}

/** Paths to every list of things (objects or text, not number series), for picking what a rotator cycles through. */
export function listPaths(value: unknown, prefix = "", depth = 5, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    if (value.length && value.every((x) => typeof x === "string" || (x !== null && typeof x === "object"))) out.push(prefix);
  } else if (value && typeof value === "object" && depth > 0) {
    for (const [k, v] of Object.entries(value)) listPaths(v, prefix ? `${prefix}.${k}` : k, depth - 1, out);
  }
  return out;
}

/**
 * Evaluates a "show only if" condition: a binding is true when it has a value
 * (not empty, false, 0 or an empty list). A leading "!" inverts it. Blank is true.
 */
export function conditionHolds(expr: string | undefined, scope: Scope): boolean {
  let e = (expr ?? "").trim();
  if (!e) return true;
  const negate = e.startsWith("!");
  if (negate) e = e.slice(1).trim();
  const v = lookup(scope, unwrap(e));
  const truthy = !(v == null || v === "" || v === false || v === 0 || v === "false" || v === "0" || (Array.isArray(v) && v.length === 0));
  return negate ? !truthy : truthy;
}
