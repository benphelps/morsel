// The "system slides": editable templates the server fills in for each
// notification. Elements bind to {{notify.*}}; the editor previews them with
// the sample data below.
import { createElement, createSlide } from "./defaults";
import type { AnimState, Slide, SystemKind } from "./types";

export const SYSTEM_KINDS: { kind: SystemKind; name: string; description: string }[] = [
  { kind: "nowplaying", name: "Now Playing", description: "A new song starts in Music (from the Mac app)." },
  { kind: "notification", name: "App notification", description: "A forwarded macOS notification, or /api/notify with a title." },
  { kind: "message", name: "Message", description: "/api/notify with just text and an optional icon." },
  { kind: "dnd", name: "Do Not Disturb", description: "Shown on its own while Do Not Disturb is on. {{dnd.until}} holds the end time, if any." },
];

/** The fields a notification provides, for the binding picker and documentation. */
export const NOTIFY_FIELDS = ["title", "subtitle", "text", "app", "detail", "icon", "image"] as const;

/** Which template a /api/notify payload uses. */
export function kindForPayload(p: { style?: string; title?: string; subtitle?: string }): SystemKind {
  if (p.style === "nowplaying") return "nowplaying";
  return p.title || p.subtitle ? "notification" : "message";
}

const st = (x: number, y: number, w: number, h: number, color = "#ffffff"): AnimState => ({ x, y, w, h, color, opacity: 1 });

function text(name: string, binding: string, font: string, state: AnimState, extra: Record<string, unknown> = {}) {
  return createElement("text", { name, text: binding, font, overflow: "marquee", marqueeMode: "once", marqueeSpeed: 20, state, ...extra } as any);
}

export function createSystemSlide(kind: SystemKind): Slide {
  const meta = SYSTEM_KINDS.find((k) => k.kind === kind)!;
  const s = createSlide(meta.name);
  s.id = `sys_${kind}`;
  s.system = kind;
  s.durationSec = 8;

  if (kind === "nowplaying") {
    s.durationSec = 10;
    s.transition = { type: "cover", direction: "right", durationMs: 450, easing: "easeOutCubic" };
    const pingpong = { marqueeMode: "pingpong", marqueeSpeed: 16 };
    s.elements = [
      // A music note stands in when the track has no artwork.
      createElement("icon", { name: "No artwork", icon: "music", scale: 2, showIf: "!{{notify.image}}", state: st(0, 0, 32, 32) } as any),
      createElement("image", { name: "Artwork", src: "{{notify.image}}", showIf: "{{notify.image}}", state: st(0, 0, 32, 32) } as any),
      text("Title", "{{notify.title}}", "5x8", st(34, 2, 30, 8), pingpong),
      text("Artist", "{{notify.subtitle}}", "tom-thumb", st(34, 13, 30, 6, "#ffc21a"), pingpong),
      text("Album", "{{notify.app}}", "tom-thumb", st(34, 22, 30, 6, "#6c7a8a"), pingpong),
    ];
  } else if (kind === "notification") {
    s.transition = { type: "push", direction: "down", durationMs: 400, easing: "easeOutCubic" };
    s.elements = [
      createElement("image", { name: "App icon", src: "{{notify.image}}", showIf: "{{notify.image}}", state: st(1, 1, 16, 16) } as any),
      createElement("icon", { name: "Icon", icon: "{{notify.icon}}", showIf: "!{{notify.image}}", state: st(1, 1, 16, 16) } as any),
      text("Title", "{{notify.title}}", "5x8", st(19, 1, 44, 8)),
      text("Detail", "{{notify.detail}}", "tom-thumb", st(19, 11, 44, 6, "#aab6c4")),
      text("Body", "{{notify.text}}", "tom-thumb", st(1, 23, 62, 6, "#ffc21a"), { marqueeSpeed: 24 }),
    ];
  } else if (kind === "dnd") {
    // Calm and dim: a moon, the time, and when it ends.
    s.durationSec = 30;
    s.transition = { type: "crossfade", direction: "left", durationMs: 800, easing: "easeInOutQuad" };
    s.elements = [
      createElement("icon", { name: "Moon", icon: "moon", scale: 2, tint: true, state: st(2, 5, 22, 22, "#5b6471") } as any),
      createElement("text", { name: "Time", text: "{{clock.HH}}:{{clock.mm}}", font: "10x20", align: "center", state: st(25, 3, 39, 20, "#6c7a8a") } as any),
      createElement("text", { name: "Until", text: "until {{dnd.until}}", font: "tb-8", align: "center", showIf: "{{dnd.until}}", state: st(25, 23, 39, 8, "#4a5360") } as any),
    ];
  } else {
    s.transition = { type: "push", direction: "down", durationMs: 400, easing: "easeOutCubic" };
    const middle = { font: "tb-8", valign: "middle", overflow: "marquee", marqueeMode: "loop", marqueeSpeed: 22 };
    s.elements = [
      createElement("icon", { name: "Icon", icon: "{{notify.icon}}", showIf: "{{notify.icon}}", state: st(1, 0, 18, 32) } as any),
      createElement("text", { name: "Text beside icon", text: "{{notify.text}}", showIf: "{{notify.icon}}", ...middle, state: st(20, 0, 44, 32) } as any),
      createElement("text", { name: "Text", text: "{{notify.text}}", showIf: "!{{notify.icon}}", align: "center", ...middle, state: st(0, 0, 64, 32) } as any),
    ];
  }
  return s;
}

export function createSystemSlides(): Slide[] {
  return SYSTEM_KINDS.map((k) => createSystemSlide(k.kind));
}

/** Adds whichever system slides the project lacks. Returns true if it changed anything. */
export function ensureSystemSlides(project: { systemSlides?: Slide[] }): boolean {
  project.systemSlides ??= [];
  let changed = false;
  for (const { kind } of SYSTEM_KINDS) {
    if (!project.systemSlides.some((s) => s.system === kind)) {
      project.systemSlides.push(createSystemSlide(kind));
      changed = true;
    }
  }
  return changed;
}

/* ---------------- sample data for the editor ---------------- */

function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  return (globalThis as any).Buffer.from(bytes).toString("base64");
}

function bitmap(size: number, px: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) data.set(px(x + 0.5, y + 0.5), (y * size + x) * 4);
  return { srcW: size, srcH: size, data: toBase64(data) };
}

/** Stand-in album art: a gradient sleeve with a record on it. */
const sampleArt = bitmap(32, (x, y) => {
  const d = Math.hypot(x - 16, y - 16);
  if (d <= 3.5) return [17, 17, 17, 255];
  if (d <= 11) return [255, 194, 26, 255];
  const k = (x + y) / 64;
  return [Math.round(255 + (58 - 255) * k), Math.round(95 + (43 - 95) * k), Math.round(162 + (217 - 162) * k), 255];
});

/** Stand-in app icon: a green rounded square with a speech bubble. */
const sampleAppIcon = bitmap(16, (x, y) => {
  const cx = Math.min(Math.max(x, 4), 12);
  const cy = Math.min(Math.max(y, 4), 12);
  if (Math.hypot(x - cx, y - cy) > 4) return [0, 0, 0, 0];
  const bubble = ((x - 8) / 5) ** 2 + ((y - 7.5) / 3.8) ** 2 <= 1 || (x > 4 && x < 7 && y > 10 && y < 13 && x + y < 16.5);
  return bubble ? [255, 255, 255, 255] : [50, 212, 106, 255];
});

/** Extra binding values a system slide sees: {{notify.*}} for notifications, {{dnd.*}} for Do Not Disturb. */
export function sampleScope(kind: SystemKind): Record<string, unknown> {
  return kind === "dnd" ? { dnd: { until: "10:15", on: true } } : { notify: SAMPLE_NOTIFY[kind] };
}

export const SAMPLE_NOTIFY: Record<SystemKind, Record<string, unknown>> = {
  nowplaying: { title: "Everything In Its Right Place", subtitle: "Radiohead", app: "Kid A", detail: "Radiohead", text: "", icon: "", image: sampleArt },
  notification: { title: "Mom", subtitle: "", app: "Messages", detail: "Messages", text: "Are you still coming for dinner tonight?", icon: "", image: sampleAppIcon },
  message: { title: "", subtitle: "", app: "", detail: "", text: "Doorbell!", icon: "bell", image: null },
  dnd: {},
};
