// Three-way merge of two edits of the project JSON (see store.ts: a save that
// was overtaken by another tab's is merged rather than overwriting it).
//
// `base` is what both sides started from, `mine` this tab's version, `theirs`
// what's saved now. Changes from both sides are kept. Lists of things with
// ids (slides, elements, keyframes, decks, sources…) merge item by item, so
// two tabs editing different elements never clash. Where both changed the same
// value differently, `mine` wins, and it's counted as a conflict.

type Json = unknown;

const same = (a: Json, b: Json) => a === b || JSON.stringify(a) === JSON.stringify(b);

const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

const idOf = (v: Json) => (isObject(v) && typeof v.id === "string" ? v.id : null);

/** Every item has a string id (an empty list counts). */
const isKeyedList = (v: Json): v is Record<string, Json>[] => Array.isArray(v) && v.every((x) => idOf(x) !== null);

export interface MergeResult<T> {
  value: T;
  /** Values both sides changed differently (this tab's edit was kept). */
  conflicts: number;
}

export function merge3<T>(base: T, mine: T, theirs: T): MergeResult<T> {
  const stats = { conflicts: 0 };
  return { value: merge(base, mine, theirs, stats) as T, conflicts: stats.conflicts };
}

function merge(base: Json, mine: Json, theirs: Json, stats: { conflicts: number }): Json {
  if (same(mine, theirs)) return mine;
  if (same(base, mine)) return theirs; // only they changed it
  if (same(base, theirs)) return mine; // only we did
  if (isObject(mine) && isObject(theirs)) {
    const b = isObject(base) ? base : {};
    const out: Record<string, Json> = {};
    for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const v = merge(b[key], mine[key], theirs[key], stats);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  if (isKeyedList(mine) && isKeyedList(theirs) && (base === undefined || isKeyedList(base))) return mergeList(base ?? [], mine, theirs, stats);
  stats.conflicts++;
  return mine;
}

function mergeList(base: Record<string, Json>[], mine: Record<string, Json>[], theirs: Record<string, Json>[], stats: { conflicts: number }): Json[] {
  const byId = (list: Record<string, Json>[]) => new Map(list.map((x) => [x.id as string, x]));
  const [b, m, t] = [byId(base), byId(mine), byId(theirs)];

  const keep = new Map<string, Json>();
  for (const id of new Set([...m.keys(), ...t.keys()])) {
    const inB = b.has(id);
    const inM = m.has(id);
    const inT = t.has(id);
    if (inM && inT) keep.set(id, merge(b.get(id), m.get(id), t.get(id), stats));
    else if (inM && !inB) keep.set(id, m.get(id)); // we added it
    else if (inT && !inB) keep.set(id, t.get(id)); // they added it
    else if (inM) {
      // They deleted it: gone, unless we changed it meanwhile.
      if (!same(b.get(id), m.get(id))) {
        stats.conflicts++;
        keep.set(id, m.get(id));
      }
    } else if (!same(b.get(id), t.get(id))) {
      // We deleted it while they changed it: our delete wins.
      stats.conflicts++;
    }
  }

  // Order: whichever side reordered; otherwise ours. Items only the other side
  // has go in after the item they followed there.
  const common = (list: Record<string, Json>[]) => list.map((x) => x.id as string).filter((id) => b.has(id));
  const theyReordered = !same(common(theirs), common(base)) && same(common(mine), common(base));
  const [lead, other] = theyReordered ? [theirs, mine] : [mine, theirs];
  const order = lead.map((x) => x.id as string);
  other.forEach((x, i) => {
    const id = x.id as string;
    if (order.includes(id)) return;
    let at = (i > 0 ? order.indexOf(other[i - 1].id as string) : -1) + 1;
    // Past anything the leading side added at the same spot.
    while (at < order.length && !b.has(order[at]) && lead.some((x) => x.id === order[at])) at++;
    order.splice(at, 0, id);
  });
  return order.filter((id) => keep.has(id)).map((id) => keep.get(id));
}
