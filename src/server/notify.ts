// Turns POST /api/notify payloads into slides, using the project's editable
// system slides (see shared/templates.ts) as layouts.
import sharp from "sharp";
import { tunedPixels } from "./ledtune";
import { minDurationMs, type ImageElement } from "../elements";
import { walk } from "../elements/tree";
import { keysFor } from "../shared/animate";
import { unwrap } from "../shared/bindings";
import { uid } from "../shared/id";
import { createSystemSlide, kindForPayload } from "../shared/templates";
import type { ElementBase, Project, Slide, SystemKind } from "../shared/types";

export interface NotifyPayload {
  title?: string;
  subtitle?: string;
  text?: string;
  /** Name of the sending app, or the album for Now Playing. */
  app?: string;
  /** A built-in icon name. */
  icon?: string;
  /** PNG/JPEG as base64 or a data: URL (album art, app icon). */
  image?: string;
  /** Text colour for plain messages. */
  color?: string;
  background?: string;
  durationSec?: number;
  style?: "nowplaying";
}

const MAX_SEC = 30;
/** Decoded images never need to be bigger than a couple of panels. */
const MAX_IMAGE_PX = 128;

/**
 * Decodes an image to w×h RGBA in a single Lanczos step from the full-size
 * source. Album art fills the box; icons keep their shape. `tune` readies a
 * photo for LEDs (see ledtune.ts).
 */
export async function decodeImage(image: string, w: number, h: number, fit: "cover" | "contain", tune = false) {
  const b64 = image.startsWith("data:") ? image.slice(image.indexOf(",") + 1) : image;
  const raw = await tunedPixels(sharp(Buffer.from(b64, "base64")).rotate() /* honour EXIF orientation */, w, h, fit, tune);
  return { srcW: w, srcH: h, data: raw.toString("base64") };
}

/** The largest box an element takes up while it plays: its size keyframes when animated, else its state. */
export function largestBox(el: Pick<ElementBase, "state" | "keyframes">) {
  const keys = keysFor(el, "size");
  const states = keys.length ? keys.map((k) => k.state) : [el.state];
  return { w: Math.max(...states.map((s) => s.w)), h: Math.max(...states.map((s) => s.h)) };
}

export function templateFor(project: Project, kind: SystemKind): Slide {
  return project.systemSlides?.find((s) => s.system === kind) ?? createSystemSlide(kind);
}

/**
 * A playable copy of the template with the notification's values attached.
 * Duration: the payload's, else the template's, stretched so "scroll once"
 * text gets to finish.
 */
export function slideFromTemplate(template: Slide, notify: Record<string, unknown>, opts: { durationSec?: number; color?: string; background?: string } = {}): Slide {
  const s: Slide = structuredClone(template);
  s.id = uid("ntf_");
  s.scope = { notify };
  if (opts.background) s.background = opts.background;
  if (opts.color)
    for (const { el } of walk(s.elements))
      if (el.type === "text") {
        el.state.color = opts.color;
        el.keyframes.forEach((k) => (k.state.color = opts.color!));
      }
  const needMs = minDurationMs(s.elements, s.scope);
  const want = opts.durationSec ?? Math.max(template.durationSec, Math.ceil(needMs / 1000));
  s.durationSec = Math.min(MAX_SEC, Math.max(2, Math.round(want)));
  return s;
}

export async function buildNotificationSlide(project: Project, p: NotifyPayload): Promise<Slide> {
  const kind = kindForPayload(p);
  const template = templateFor(project, kind);
  let image: unknown = null;
  if (p.image) {
    // Decode once, at the biggest the template's image box gets. (An animated box's own
    // state is unused and can be anything, e.g. 1×1, which would flatten the art to one colour.)
    const target = [...walk(template.elements)].map((h) => h.el).find((e): e is ImageElement => e.type === "image" && unwrap(e.src ?? "") === "notify.image");
    const box = target ? largestBox(target) : { w: 32, h: 32 };
    const w = Math.min(MAX_IMAGE_PX, Math.max(1, Math.round(box.w)));
    const h = Math.min(MAX_IMAGE_PX, Math.max(1, Math.round(box.h)));
    const art = kind === "nowplaying";
    image = await decodeImage(p.image, w, h, art ? "cover" : "contain", art);
  }
  const notify = {
    title: p.title ?? "",
    subtitle: p.subtitle ?? "",
    text: p.text ?? "",
    app: p.app ?? "",
    // One line of context: the subtitle, or failing that the app name.
    detail: p.subtitle || p.app || "",
    icon: p.icon ?? "",
    image,
  };
  return slideFromTemplate(template, notify, { durationSec: p.durationSec, color: p.color, background: p.background });
}
