import { lookup, unwrap, type Scope } from "../../shared/bindings";
import { parseColor } from "../../shared/color";
import type { ElementBase } from "../../shared/types";
import type { ElementDef } from "../types";

export interface ImageElement extends ElementBase {
  type: "image";
  /** Native pixel size of the stored bitmap. */
  srcW: number;
  srcH: number;
  /** Base64 RGBA, srcW * srcH * 4 bytes. */
  data: string;
  /** Take the bitmap from data instead, e.g. {{notify.image}} ({srcW, srcH, data}). */
  src?: string;
  /** Multiply the image by state.color (white = untouched). */
  tint: boolean;
}

const bytesCache = new Map<string, Uint8Array>();

export function decodeBase64(b64: string): Uint8Array {
  const hit = bytesCache.get(b64);
  if (hit) return hit;
  let bytes: Uint8Array;
  if (typeof atob === "function") {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new Uint8Array((globalThis as any).Buffer.from(b64, "base64"));
  }
  if (bytesCache.size > 200) bytesCache.clear();
  bytesCache.set(b64, bytes);
  return bytes;
}

/** The bitmap to draw: bound data ({{notify.image}}) when set, else the uploaded one. */
function imageSource(el: ImageElement, scope: Scope): { srcW: number; srcH: number; data: string } | null {
  if (el.src?.trim()) {
    const v = lookup(scope, unwrap(el.src)) as any;
    return v && typeof v.data === "string" && v.srcW > 0 && v.srcH > 0 ? v : null;
  }
  return el.data ? el : null;
}

export const imageElement: ElementDef<ImageElement> = {
  type: "image",
  label: "Image",
  group: "content",
  icon: "M2.5 3.5h11v9h-11z M2.5 11l3.5-3.5 3 3 1.5-1.5 3 3 M10.5 6h.01",
  create: () => ({ srcW: 1, srcH: 1, data: "", tint: false, lockAspect: true, state: { x: 0, y: 0, w: 16, h: 16, color: "#ffffff", opacity: 1 } }),
  draw(p, el, s, { scope }) {
    const img = imageSource(el, scope);
    if (!img || s.w <= 0 || s.h <= 0) return;
    const src = decodeBase64(img.data);
    const tint = el.tint ? parseColor(s.color) : [255, 255, 255];
    // Nearest-neighbour scaling from the bitmap to the box.
    for (let y = 0; y < s.h; y++) {
      const sy = Math.min(img.srcH - 1, Math.floor((y * img.srcH) / s.h));
      for (let x = 0; x < s.w; x++) {
        const sx = Math.min(img.srcW - 1, Math.floor((x * img.srcW) / s.w));
        const i = (sy * img.srcW + sx) * 4;
        const a = (src[i + 3] / 255) * s.opacity;
        p.px(s.x + x, s.y + y, (src[i] * tint[0]) / 255, (src[i + 1] * tint[1]) / 255, (src[i + 2] * tint[2]) / 255, a);
      }
    }
  },
  bindable: ["src"],
};
