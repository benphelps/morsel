import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { LogController } from "fastify";
import { existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { renderClip } from "../shared/clip";
import { buildScope, LIVE_PLUGINS } from "../shared/live";
import type { Project } from "../shared/types";
import { DataManager } from "./data";
import { DndStore } from "./dnd";
import { brightnessNow, DeviceGateway, dwellFor } from "./device";
import { DEVICE_MAX_BYTES, encodeWebp } from "./encode";
import { buildNotificationSlide, slideFromTemplate, templateFor, type NotifyPayload } from "./notify";
import { SAMPLE_NOTIFY, sampleScope } from "../shared/templates";
import { uid } from "../shared/id";
import type { DndState, Slide, SystemKind } from "../shared/types";
import { ICONS } from "../shared/icons";
import { allPluginInfo, FETCH_PLUGINS } from "./plugins";
import { Store } from "./store";

const PORT = Number(process.env.PORT ?? 8000);

const store = new Store();
const data = new DataManager();
data.sync(store.project.sources);
const dnd = new DndStore();
const device = new DeviceGateway(store, data, dnd);
// So the editor's mirror switches clips the moment the device does, and fetches the next one ahead.
device.on("change", () => broadcast("device", { current: device.status.current, queued: device.status.queued }));
dnd.on("change", (state: DndState, prev: DndState) => {
  // Switch the display only when DND or its slide changes; a brightness tweak just adjusts brightness.
  if (state.enabled !== prev.enabled || (state.enabled && state.slideId !== prev.slideId)) device.applyDnd();
  else device.syncBrightness();
  broadcast("dnd", state);
});

let changeTimer: NodeJS.Timeout | null = null;
/** Re-render the device's queued slide once edits or data settle. */
function scheduleRequeue() {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => device.projectChanged(), 1500);
}
store.on("change", (p: Project, origin: string) => {
  data.sync(p.sources);
  scheduleRequeue();
  // Other open editors reload; the tab that saved ignores its own echo.
  broadcast("project", { origin, revision: store.revision });
});

/* Editors listen here for fresh data instead of polling. */
const eventClients = new Set<ServerResponse>();
function broadcast(event: string, payload: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of eventClients) res.write(msg);
}
data.on("update", () => {
  broadcast("sources", data.status());
  scheduleRequeue();
});
setInterval(() => {
  for (const res of eventClients) res.write(": keepalive\n\n");
}, 25_000);

// Skip request logs for the endpoints the editor polls; everything else (and all errors) still logs.
const QUIET = ["/api/device", "/api/sources/status", "/api/render/", "/api/events", "/api/project", "/device/next"];
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  logController: new LogController({ disableRequestLogging: (req) => req.method === "GET" && QUIET.some((q) => req.url.startsWith(q)) }),
  bodyLimit: 20 * 1024 * 1024,
});
await app.register(fastifyWebsocket);

/* ---------------- device endpoints ---------------- */

// Point the firmware's image URL at ws://<host>:8000/device/ws …
app.get("/device/ws", { websocket: true }, (socket, req) => {
  req.log.info("device connected over websocket");
  device.attach(socket);
});

// … or at http://<host>:8000/device/next for plain polling.
app.get("/device/next", async (_req, reply) => {
  const clip = await device.nextForHttp();
  return reply
    .header("content-type", "image/webp")
    .header("Tronbyt-Dwell-Secs", String(Math.min(299, clip.dwellSecs)))
    .header("Tronbyt-Brightness", String(brightnessNow(store.project, Date.now(), dnd.state)))
    .send(clip.webp);
});

/* ---------------- editor API ---------------- */

app.get("/api/project", async (_req, reply) => reply.header("x-morsel-revision", store.revision).send(store.project));

// An editor sends the revision it last saw as x-morsel-base. If the project
// has moved on since (another tab, or a pushed source), the save is refused
// with the current project, so the editor can merge instead of overwriting.
// Without the header (scripts, curl) it simply saves.
app.put<{ Body: Project }>("/api/project", async (req, reply) => {
  const p = req.body;
  if (!p || p.version !== 1 || !Array.isArray(p.slides) || !Array.isArray(p.decks)) return reply.code(400).send({ error: "Invalid project" });
  const base = req.headers["x-morsel-base"];
  if (typeof base === "string" && base !== store.revision) return reply.code(409).send({ error: "conflict", revision: store.revision, project: store.project });
  store.save(p, String(req.headers["x-morsel-client"] ?? ""));
  return { ok: true, savedAt: Date.now(), revision: store.revision };
});

app.get("/api/plugins", async () => allPluginInfo());

app.get("/api/sources/status", async () => data.status());

app.get("/api/events", (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`event: sources\ndata: ${JSON.stringify(data.status())}\n\n`);
  res.write(`event: dnd\ndata: ${JSON.stringify(dnd.state)}\n\n`);
  eventClients.add(res);
  req.raw.on("close", () => eventClients.delete(res));
});

app.post<{ Params: { id: string } }>("/api/sources/:id/refresh", async (req) => {
  await data.refresh(req.params.id);
  return data.status().find((s) => s.id === req.params.id) ?? null;
});

app.post<{ Body: { plugin: string; config: Record<string, unknown> } }>("/api/sources/test", async (req) => {
  const { plugin, config } = req.body;
  const live = LIVE_PLUGINS[plugin];
  if (live) return { ok: true, data: live.compute(config, Date.now()) };
  const p = FETCH_PLUGINS[plugin];
  if (!p) return { ok: false, error: `Unknown plugin ${plugin}` };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    return { ok: true, data: await p.fetch(config as Record<string, any>, ctl.signal) };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  } finally {
    clearTimeout(t);
  }
});

// Exactly what the device would receive for a slide, for size/frame checks.
app.get<{ Params: { id: string } }>("/api/render/:id", async (req, reply) => {
  const p = store.project;
  const id = req.params.id.replace(/\.webp$/, "");
  const found = p.slides.find((s) => s.id === id) ?? p.systemSlides?.find((s) => s.id === id);
  if (!found) return reply.code(404).send({ error: "No such slide" });
  // System slides are measured with their sample notification, as the editor shows them.
  const slide = found.system ? sampleSlide(found) : found;
  const fetched = data.snapshot();
  const now = Date.now();
  const clip = renderClip(slide, { fps: p.fps, scopeAt: (t) => ({ ...buildScope(p.sources, fetched, now + t), ...slide.scope }) });
  const webp = await encodeWebp(clip);
  return reply
    .header("content-type", "image/webp")
    .header("cache-control", "no-store")
    .header("x-frames", String(clip.frames.length))
    .header("x-bytes", String(webp.length))
    .header("x-dwell", String(dwellFor(clip.frames.length, Math.round(clip.durationMs / 1000))))
    .header("x-max-bytes", String(DEVICE_MAX_BYTES))
    .send(webp);
});

app.get("/api/device", async () => {
  const s = device.status;
  const stale = s.transport === "http" && s.lastSeen && Date.now() - s.lastSeen > 5 * 60_000;
  // `now` lets the editor line its clock up with ours, to play the mirror in step with `current.since`.
  return { ...s, connected: s.connected && !stale, now: Date.now(), brightnessNow: brightnessNow(store.project, Date.now(), dnd.state), hosts: lanHosts(), dnd: dnd.state };
});

app.get("/api/device/current.webp", async (_req, reply) => {
  if (!device.lastWebp) return reply.code(404).send();
  return reply.header("content-type", "image/webp").header("cache-control", "no-store").send(device.lastWebp);
});

app.get<{ Params: { id: string } }>("/api/device/clip/:id.webp", async (req, reply) => {
  const clip = device.clipById(req.params.id);
  if (!clip) return reply.code(404).send();
  // A clip never changes once rendered (a re-render gets a new id), so it can be cached for good.
  return reply.header("content-type", "image/webp").header("cache-control", "private, max-age=3600, immutable").send(clip.webp);
});

app.post<{ Body: { slideId: string } }>("/api/device/show", async (req, reply) => {
  const slide = store.project.slides.find((s) => s.id === req.body.slideId);
  if (!slide) return reply.code(404).send({ error: "No such slide" });
  await device.showNow(slide);
  return { ok: true };
});

// Interrupt the deck from anywhere: curl -d '{"text":"Doorbell!","icon":"bell"}' -H 'content-type: application/json' host:8000/api/notify
// Also takes title/subtitle/app, an image (base64 PNG/JPEG) and style "nowplaying"; see NotifyPayload.
app.post<{ Body: NotifyPayload & { slideId?: string } }>("/api/notify", async (req, reply) => {
  const b = req.body ?? {};
  let slide;
  if (b.slideId) slide = store.project.slides.find((s) => s.id === b.slideId);
  else {
    try {
      slide = await buildNotificationSlide(store.project, b);
    } catch (err: any) {
      return reply.code(400).send({ error: `Couldn't use that notification: ${err?.message ?? err}` });
    }
  }
  if (!slide) return reply.code(404).send({ error: "No such slide" });
  const shown = await device.showNow(slide, { notification: !b.slideId });
  return shown ? { ok: true, durationSec: slide.durationSec } : { ok: true, suppressed: true, durationSec: 0 };
});

app.get("/api/icons", async () => Object.keys(ICONS));

// Data sent by another app (the Mac app's calendar) for a push source. Creates the source if needed.
app.post<{ Params: { plugin: string }; Body: unknown }>("/api/push/:plugin", async (req, reply) => {
  const plugin = FETCH_PLUGINS[req.params.plugin];
  if (!plugin?.info.push) return reply.code(404).send({ error: "No such push source type" });
  let source = store.project.sources.find((s) => s.plugin === plugin.info.id);
  if (!source) {
    const project = structuredClone(store.project);
    let alias = plugin.info.defaultAlias;
    for (let n = 2; project.sources.some((s) => s.alias === alias); n++) alias = `${plugin.info.defaultAlias}${n}`;
    source = { id: uid("src_"), alias, plugin: plugin.info.id, config: {}, refreshSec: 0 };
    project.sources.push(source);
    store.save(project);
  }
  data.push(source.id, req.body);
  return { ok: true, alias: source.alias };
});

// Plays a system slide with its sample data, for previewing a design on the device.
app.post<{ Body: { kind: SystemKind } }>("/api/notify/sample", async (req, reply) => {
  const kind = req.body?.kind;
  if (!SAMPLE_NOTIFY[kind]) return reply.code(400).send({ error: "Unknown kind" });
  await device.showNow(sampleSlide(templateFor(store.project, kind)));
  return { ok: true };
});

/* ---------------- Do Not Disturb ---------------- */

app.get("/api/dnd", async () => dnd.state);

// {enabled, minutes?|until?, slideId?, brightness?, muteNotifications?}
app.post<{ Body: Partial<DndState> & { minutes?: number } }>("/api/dnd", async (req, reply) => {
  const b = req.body ?? {};
  const patch: Partial<DndState> = {};
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (typeof b.minutes === "number" && b.minutes > 0) {
    patch.enabled = true;
    patch.until = Date.now() + b.minutes * 60_000;
  } else if (b.until === null || typeof b.until === "number") patch.until = b.until;
  if (b.slideId === null || (typeof b.slideId === "string" && store.project.slides.some((s) => s.id === b.slideId))) patch.slideId = b.slideId ?? null;
  else if (b.slideId !== undefined) return reply.code(400).send({ error: "No such slide" });
  if (b.brightness === null || typeof b.brightness === "number") patch.brightness = b.brightness == null ? null : Math.max(0, Math.min(100, Math.round(b.brightness)));
  if (typeof b.muteNotifications === "boolean") patch.muteNotifications = b.muteNotifications;
  dnd.update(patch);
  return dnd.state;
});

/** A system slide with its sample data attached, as the editor previews it. */
function sampleSlide(template: Slide): Slide {
  if (template.system && template.system !== "dnd") return slideFromTemplate(template, SAMPLE_NOTIFY[template.system], { durationSec: template.durationSec });
  const s = structuredClone(template);
  s.id = uid("smp_");
  s.scope = { ...s.scope, ...sampleScope(template.system ?? "dnd") };
  return s;
}

/** Addresses the device could use to reach us. Inside Docker, set PUBLIC_HOST to the host's LAN address. */
function lanHosts(): string[] {
  if (process.env.PUBLIC_HOST) return [process.env.PUBLIC_HOST.includes(":") ? process.env.PUBLIC_HOST : `${process.env.PUBLIC_HOST}:${PORT}`];
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && !a.address.startsWith("172.")) out.push(`${a.address}:${PORT}`);
  return out;
}

/* ---------------- web app ---------------- */

const webRoot = join(process.cwd(), "dist", "web");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/device")) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "Not found" });
  });
}

await app.listen({ port: PORT, host: "0.0.0.0" });
