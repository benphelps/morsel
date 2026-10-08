// What a {{binding}} can be picked from: the fields of the data right now that
// fit where it's used, grouped by where they come from (see BindingField).
import { flattenPaths, listPaths, lookup, numberPaths, numericSeriesPaths, type Scope } from "../shared/bindings";
import { isBitmap } from "../elements/rotator/element";

/** What a binding has to point at to make sense where it's used. */
export type BindingKind = "number" | "list" | "series" | "image" | "text" | "any";

export interface BindingRow {
  /** What goes inside {{ }}. */
  path: string;
  value: unknown;
}

export interface BindingGroup {
  id: string;
  rows: BindingRow[];
}

/** Paths to every image (an {srcW, srcH, data} bitmap), e.g. a news item's favicon. */
function imagePaths(value: unknown, prefix = "", depth = 5, out: string[] = []): string[] {
  if (isBitmap(value)) out.push(prefix);
  else if (Array.isArray(value)) value.slice(0, 5).forEach((v, i) => depth > 0 && imagePaths(v, `${prefix}.${i}`, depth - 1, out));
  else if (value && typeof value === "object" && depth > 0) for (const [k, v] of Object.entries(value)) imagePaths(v, prefix ? `${prefix}.${k}` : k, depth - 1, out);
  return out;
}

/** The fields of the data that can stand for `kind`, with what each holds now. */
export function bindingRows(scope: Scope, kind: BindingKind): BindingRow[] {
  // $-names are the renderer's own bookkeeping.
  const data = Object.fromEntries(Object.entries(scope).filter(([k]) => !k.startsWith("$")));
  // Every single value: text, numbers, true or false (an image's own fields are for image elements).
  const leaves = () =>
    Object.keys(data)
      .flatMap((k) => flattenPaths(data[k], k))
      .filter((x) => !/\.(data|srcW|srcH)$/.test(x.path) && (x.value === null || typeof x.value !== "object"))
      .map((x) => x.path);
  const paths =
    kind === "number"
      ? numberPaths(data).filter((p) => !/\.(srcW|srcH)$/.test(p))
      : kind === "list"
        ? listPaths(data)
        : kind === "series"
          ? numericSeriesPaths(data)
          : kind === "image"
            ? imagePaths(data)
            : kind === "text"
              ? leaves()
              : [...leaves(), ...listPaths(data)];
  return [...new Set(paths)].map((path) => ({ path, value: lookup(data, path) }));
}

/**
 * The rows grouped by where they come from: inside a rotator the item (with
 * its index and count) first, then notification fields, then each data source.
 */
export function groupRows(rows: BindingRow[], scope: Scope): BindingGroup[] {
  const inRotator = "item" in scope;
  const groupOf = (path: string) => {
    const root = path.split(".")[0];
    return inRotator && (root === "index" || root === "count") ? "item" : root;
  };
  const byGroup = new Map<string, BindingRow[]>();
  for (const r of rows) byGroup.set(groupOf(r.path), [...(byGroup.get(groupOf(r.path)) ?? []), r]);
  const order = [...new Set([...(inRotator ? ["item"] : []), "notify", ...Object.keys(scope), ...byGroup.keys()])];
  return order.filter((id) => byGroup.has(id)).map((id) => ({ id, rows: byGroup.get(id)! }));
}

/** What a value is, in a few words, e.g. "350.68", "list of 4" or "16×16 image". */
export function preview(v: unknown): string {
  if (isBitmap(v)) {
    const b = v as { srcW: number; srcH: number };
    return `${b.srcW}×${b.srcH} image`;
  }
  if (Array.isArray(v)) return v.length && v.every((x) => typeof x === "number") ? `${v.length} numbers` : `list of ${v.length}`;
  if (v === undefined || v === null || v === "") return "empty";
  if (typeof v === "object") return "…";
  return String(v);
}
