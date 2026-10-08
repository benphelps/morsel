import { useEffect, useRef, useState } from "react";
import { isBitmap, itemScope, rotatorItems, type RotatorElement } from "../../elements/rotator/element";
import { scopeAt, useEditContext, useStore } from "../store";
import { Icon } from "./Icon";

// A drawer along the bottom of the inspector, while a rotator is being edited
// (or is selected): the fields of the item it's showing, with what each holds
// right now. Clicking one copies its binding.

interface Row {
  path: string;
  text?: string;
  image?: { srcW: number; srcH: number; data: string };
}

/** An item's fields as rows: nested objects flattened, images and lists kept whole. */
function rowsOf(value: unknown, path: string, depth = 3, out: Row[] = []): Row[] {
  if (isBitmap(value)) out.push({ path, image: value as Row["image"] });
  else if (Array.isArray(value)) out.push({ path, text: `list of ${value.length}` });
  else if (value !== null && typeof value === "object" && depth > 0) for (const [k, v] of Object.entries(value)) rowsOf(v, `${path}.${k}`, depth - 1, out);
  else out.push({ path, text: value == null || value === "" ? "" : String(value) });
  return out;
}

/** An RGBA bitmap, drawn crisp at a small size. */
function BitmapThumb({ image }: { image: NonNullable<Row["image"]> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const bytes = Uint8ClampedArray.from(atob(image.data), (ch) => ch.charCodeAt(0));
    if (bytes.length !== image.srcW * image.srcH * 4) return;
    ctx.putImageData(new ImageData(bytes, image.srcW, image.srcH), 0, 0);
  }, [image]);
  return <canvas ref={ref} className="kv-thumb" width={image.srcW} height={image.srcH} />;
}

const OPEN_KEY = "morsel.itemData.open";

export function ItemDataDrawer() {
  const ctx = useEditContext();
  const elementId = useStore((s) => s.elementId);
  useStore((s) => s.sourceStatus); // the values follow the data
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [copied, setCopied] = useState<string | null>(null);
  if (!ctx) return null;

  // A selected rotator shows its first item; inside one, the item being edited.
  const selected = ctx.elements.find((e) => e.id === elementId);
  let scope: Record<string, unknown> | null = null;
  let name = "";
  if (selected?.type === "rotator") {
    const base = scopeAt(Date.now());
    const items = rotatorItems(selected as RotatorElement, base);
    if (items.length) scope = itemScope(base, items, 0);
    name = selected.name;
  } else {
    const level = [...ctx.levels].reverse().find((l) => l.kind === "rotator");
    if (level && level.items) {
      scope = scopeAt(Date.now());
      name = level.container.name;
    }
  }
  if (!scope) return null;

  const rows = [...rowsOf(scope.item, "item"), { path: "index", text: String(scope.index) }, { path: "count", text: String(scope.count) }];
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    } catch {
      /* not kept: fine */
    }
  };
  const copy = (path: string) => {
    void navigator.clipboard?.writeText(`{{${path}}}`).catch(() => {});
    setCopied(path);
    setTimeout(() => setCopied((c) => (c === path ? null : c)), 1200);
  };

  return (
    <div className={`item-data ${open ? "open" : ""}`}>
      <button className="item-data-head" onClick={toggle} title={open ? "Hide the item's data" : "What each field of the item holds right now, to use in bindings"}>
        <span className="item-data-title">Item data</span>
        <span className="dim small">
          {name} · {String(scope.index)} of {String(scope.count)}
        </span>
        <Icon name="chevron" size={12} className="item-data-caret" />
      </button>
      {open && (
        <div className="item-data-body">
          {rows.map((r) => (
            <button key={r.path} className="kv-row" title={`Copy {{${r.path}}}`} onClick={() => copy(r.path)}>
              <code className="kv-key">
                {r.path.startsWith("item.") ? (
                  <>
                    <span className="dim">item.</span>
                    {r.path.slice(5)}
                  </>
                ) : (
                  r.path
                )}
              </code>
              <span className="kv-val">
                {copied === r.path ? (
                  <span className="kv-copied">Copied</span>
                ) : r.image ? (
                  <>
                    <BitmapThumb image={r.image} />
                    <span className="dim">
                      {r.image.srcW}×{r.image.srcH} image
                    </span>
                  </>
                ) : r.text ? (
                  <span className="kv-text">{r.text}</span>
                ) : (
                  <span className="dim">empty</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
