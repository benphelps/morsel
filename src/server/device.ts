import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { renderClip } from "../shared/clip";
import { createElement, createSlide } from "../shared/defaults";
import { conditionHolds } from "../shared/bindings";
import { buildScope } from "../shared/live";
import type { Frame } from "../shared/render";
import { createSystemSlide } from "../shared/templates";
import type { DeviceStatus, DndState, Project, Slide } from "../shared/types";
import type { DndStore } from "./dnd";
import type { DataManager } from "./data";
import { encodeWebp } from "./encode";
import { uid } from "../shared/id";
import { PlayCounter } from "./plays";
import type { Store } from "./store";

export interface RenderedClip {
  /** Unique across restarts, so an editor never mixes up a clip it cached earlier. */
  id: string;
  slide: Slide;
  webp: Buffer;
  frames: number;
  durationMs: number;
  dwellSecs: number;
  lastFrame: Frame;
  /** False for interrupts, which don't advance the deck. */
  fromDeck: boolean;
  /** Which showing of the slide it was rendered as (see PlayCounter). */
  play: number;
}

/**
 * The firmware keeps looping a clip until `dwell_secs` has elapsed, checking
 * only between loops. A dwell just under the clip length plays it exactly
 * once; a single still frame simply holds for the dwell.
 */
export function dwellFor(frames: number, durationSec: number) {
  return frames === 1 ? durationSec : Math.max(1, durationSec - 1);
}

function minutesInTz(tz: string, now: number) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export function brightnessNow(project: Project, now = Date.now(), dnd?: DndState) {
  const normal = scheduledBrightness(project, now);
  // Do Not Disturb only ever dims: at night, a brighter DND level would be the opposite of calm.
  return dnd?.enabled && dnd.brightness != null ? Math.min(dnd.brightness, normal) : normal;
}

function scheduledBrightness(project: Project, now: number) {
  const d = project.device;
  if (!d.night.enabled) return d.brightness;
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const cur = minutesInTz(d.timezone, now);
  const start = toMin(d.night.start);
  const end = toMin(d.night.end);
  const night = start <= end ? cur >= start && cur < end : cur >= start || cur < end;
  return night ? d.night.brightness : d.brightness;
}

/**
 * Plays the active deck on the device, over WebSocket (push) or HTTP (poll).
 * Emits "change" when the display moves on to another clip, or another is queued.
 */
export class DeviceGateway extends EventEmitter {
  private socket: WebSocket | null = null;
  private deckIndex = -1;
  private interrupts: Slide[] = [];
  /** Clips sent but not yet reported as queued, in send order. */
  private unacked: RenderedClip[] = [];
  /** Device image counter → clip. */
  private byCounter = new Map<number, RenderedClip>();
  private queuedClip: RenderedClip | null = null;
  private currentClip: RenderedClip | null = null;
  private lastSentFrame: Frame | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private sending: Promise<void> | null = null;
  private lastBrightness = -1;
  /** Showings per slide, for rotators that show a few items each time. */
  private plays = new PlayCounter();
  status: DeviceStatus = { connected: false, transport: null, lastSeen: null, clientInfo: null, current: null, queued: null };
  lastWebp: Buffer | null = null;

  constructor(
    private store: Store,
    private data: DataManager,
    private dnd: DndStore,
  ) {
    super();
    setInterval(() => this.syncBrightness(), 30_000);
  }

  /** A clip the device has or is about to show, so the editor can fetch the next one ahead of time. */
  clipById(id: string): RenderedClip | null {
    return [this.currentClip, this.queuedClip, ...this.unacked].find((c) => c?.id === id) ?? null;
  }

  private get project() {
    return this.store.project;
  }

  /** Enabled slides of the active deck whose "only when" condition holds right now. */
  private deckSlides(): Slide[] {
    const p = this.project;
    const deck = p.decks.find((d) => d.id === p.activeDeckId) ?? p.decks[0];
    if (!deck) return [];
    const scope = buildScope(p.sources, this.data.snapshot(), Date.now());
    return deck.items
      .filter((i) => i.enabled && conditionHolds(i.showIf, scope))
      .map((i) => p.slides.find((s) => s.id === i.slideId))
      .filter((s): s is Slide => !!s);
  }

  private pickNext(): { slide: Slide; fromDeck: boolean } {
    const interrupt = this.interrupts.shift();
    if (interrupt) return { slide: interrupt, fromDeck: false };
    // Do Not Disturb pauses the deck on one slide.
    if (this.dnd.state.enabled) return { slide: this.dndSlide(), fromDeck: false };
    const slides = this.deckSlides();
    if (!slides.length) return { slide: this.placeholder(), fromDeck: false };

    this.deckIndex = (this.deckIndex + 1) % slides.length;
    return { slide: slides[this.deckIndex], fromDeck: true };
  }

  /** The device drops a queued image when a newer one arrives; replay that deck slide later. */
  private rewindDroppedQueued() {
    if (!this.queuedClip?.fromDeck) return;
    const n = this.deckSlides().length;
    if (n) this.deckIndex = (this.deckIndex - 1 + n) % n;
    this.queuedClip = null;
  }

  /** The slide shown during Do Not Disturb, with {{dnd.until}} filled in. */
  private dndSlide(): Slide {
    const d = this.dnd.state;
    const p = this.project;
    const base = (d.slideId && p.slides.find((s) => s.id === d.slideId)) || p.systemSlides?.find((s) => s.system === "dnd") || createSystemSlide("dnd");
    const fmt = (hour12: boolean) =>
      d.until ? new Intl.DateTimeFormat("en-US", { timeZone: p.device.timezone || undefined, hour: hour12 ? "numeric" : "2-digit", minute: "2-digit", hourCycle: hour12 ? "h12" : "h23" }).format(d.until) : "";
    const s: Slide = structuredClone(base);
    s.id = `dnd_${base.id}`;
    s.scope = { ...base.scope, dnd: { on: true, until: fmt(false), until12: fmt(true) } };
    return s;
  }

  /** Do Not Disturb changed: switch the display over now rather than after the current slide. */
  applyDnd() {
    this.syncBrightness();
    if (!this.socket) return;
    this.rewindDroppedQueued();
    void this.sendNext({ immediate: true });
  }

  private placeholder(): Slide {
    const deck = this.project.decks.find((d) => d.id === this.project.activeDeckId);
    // Every slide may be switched off by its "only when" condition, rather than the deck being empty.
    const message = deck?.items.some((i) => i.enabled) ? "Nothing to\nshow now" : "Add slides\nto the deck";
    const s = createSlide("Empty deck");
    s.durationSec = 10;
    s.transition = { ...s.transition, type: "cut" };
    s.elements = [createElement("text", { text: message, font: "tom-thumb", align: "center", valign: "middle", state: { x: 0, y: 0, w: 64, h: 32, color: "#6c7a8a", opacity: 1 } } as any)];
    return s;
  }

  async render(slide: Slide, startsAt: number, prev: Frame | null, fromDeck = false): Promise<RenderedClip> {
    const p = this.project;
    const fetched = this.data.snapshot();
    // Rendered as the slide's next showing; it only counts once it's on the display (see setCurrent),
    // so a clip that's re-rendered or dropped from the queue doesn't skip ahead.
    const play = this.plays.get(slide.id);
    // Notification slides carry their own {{notify.*}} values.
    const clip = renderClip(slide, { fps: p.fps, prev, scopeAt: (t) => ({ ...buildScope(p.sources, fetched, startsAt + t), ...slide.scope, $play: play }) });
    const webp = await encodeWebp(clip);
    return {
      id: uid("clip_"),
      slide,
      webp,
      frames: clip.frames.length,
      durationMs: clip.durationMs,
      dwellSecs: dwellFor(clip.frames.length, Math.round(clip.durationMs / 1000)),
      lastFrame: clip.frames[clip.frames.length - 1],
      fromDeck,
      play,
    };
  }

  /* ---------------- WebSocket transport ---------------- */

  attach(ws: WebSocket) {
    this.socket?.close();
    this.socket = ws;
    this.unacked = [];
    this.byCounter.clear();
    this.queuedClip = null;
    this.status = { ...this.status, connected: true, transport: "websocket", lastSeen: Date.now() };
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      this.status.lastSeen = Date.now();
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.client_info) this.status.clientInfo = msg.client_info;
      if (typeof msg.queued === "number") this.onQueued(msg.queued);
      if (typeof msg.displaying === "number") this.onDisplaying(msg.displaying);
    });
    ws.on("close", () => {
      if (this.socket !== ws) return;
      this.socket = null;
      this.status = { ...this.status, connected: false, queued: null };
      if (this.watchdog) clearTimeout(this.watchdog);
    });
    this.lastBrightness = -1;
    this.syncBrightness();
    // Start the deck straight away; the first image also ends the boot animation.
    void this.sendNext({ immediate: true });
  }

  private sendJson(obj: object) {
    this.socket?.send(JSON.stringify(obj));
  }

  syncBrightness() {
    const b = brightnessNow(this.project, Date.now(), this.dnd.state);
    if (b !== this.lastBrightness && this.socket) {
      this.sendJson({ brightness: b });
      this.lastBrightness = b;
    }
  }

  private onQueued(counter: number) {
    const clip = this.unacked.shift();
    if (clip) this.byCounter.set(counter, clip);
  }

  private onDisplaying(counter: number) {
    const clip = this.byCounter.get(counter);
    for (const k of this.byCounter.keys()) if (k <= counter) this.byCounter.delete(k);
    if (!clip) return;
    this.setCurrent(clip);
    if (this.queuedClip === clip) this.queuedClip = null;
    // Queue the following slide now so it's ready when this one finishes.
    void this.sendNext({ startsAt: Date.now() + clip.durationMs });
  }

  private setCurrent(clip: RenderedClip) {
    // A deck slide on the display counts as a showing; the next one carries on from here.
    if (clip.fromDeck && clip.play === this.plays.get(clip.slide.id)) this.plays.shown(clip.slide.id);
    this.currentClip = clip;
    this.lastWebp = clip.webp;
    this.status.current = { clip: clip.id, slideId: clip.slide.id, name: clip.slide.name, since: Date.now(), bytes: clip.webp.length, frames: clip.frames };
    this.status.queued = this.queuedClip && this.queuedClip !== clip ? { clip: this.queuedClip.id, slideId: this.queuedClip.slide.id, name: this.queuedClip.slide.name } : null;
    this.emit("change");
    // Some firmware doesn't report "displaying"; don't stall if it goes quiet.
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.socket && this.queuedClip === null) void this.sendNext({});
    }, clip.durationMs + 10_000);
  }

  private async sendNext(opts: { immediate?: boolean; startsAt?: number; slide?: Slide; replaceQueued?: boolean }) {
    // Serialise sends so two renders never race each other onto the wire.
    const run = async () => {
      if (!this.socket) return;
      if (opts.slide && !opts.replaceQueued) this.rewindDroppedQueued();
      const picked = opts.slide ? { slide: opts.slide, fromDeck: !!opts.replaceQueued && !!this.queuedClip?.fromDeck } : this.pickNext();
      const slide = picked.slide;
      const prev = opts.immediate || opts.replaceQueued ? (this.currentClip?.lastFrame ?? null) : this.lastSentFrame;
      const clip = await this.render(slide, opts.startsAt ?? Date.now(), prev, picked.fromDeck);
      if (!this.socket) return;
      this.sendJson({ dwell_secs: clip.dwellSecs });
      this.socket.send(clip.webp, { binary: true });
      if (opts.immediate) this.sendJson({ immediate: true });
      this.unacked.push(clip);
      this.queuedClip = clip;
      this.lastSentFrame = clip.lastFrame;
      this.status.queued = { clip: clip.id, slideId: slide.id, name: slide.name };
      this.emit("change");
      if (opts.immediate) this.lastWebp = clip.webp;
    };
    const p = (this.sending ?? Promise.resolve()).then(run, run).catch((err) => console.error("[device] send failed:", err));
    this.sending = p;
    await p;
  }

  /** Re-render whatever is queued after an edit, so changes show on the next slide. */
  projectChanged() {
    this.syncBrightness();
    if (!this.socket || !this.queuedClip) return;
    const queued = this.queuedClip;
    const fresh = this.project.slides.find((s) => s.id === queued.slide.id);
    const startsAt = this.currentClip ? Number(this.status.current?.since ?? Date.now()) + this.currentClip.durationMs : Date.now();
    if (fresh) void this.sendNext({ slide: fresh, startsAt, replaceQueued: true });
  }

  /**
   * Shows a slide right now, then carries on. Notifications are held back
   * during Do Not Disturb (if it mutes them); returns false when that happens.
   */
  async showNow(slide: Slide, opts: { notification?: boolean } = {}): Promise<boolean> {
    if (opts.notification && this.dnd.state.enabled && this.dnd.state.muteNotifications) return false;
    if (this.socket) {
      await this.sendNext({ slide, immediate: true });
    } else {
      this.interrupts.push(slide);
    }
    return true;
  }

  /* ---------------- HTTP transport ---------------- */

  async nextForHttp(): Promise<RenderedClip> {
    this.status = { ...this.status, connected: true, transport: "http", lastSeen: Date.now() };
    const next = this.pickNext();
    const clip = await this.render(next.slide, Date.now(), this.lastSentFrame, next.fromDeck);
    this.lastSentFrame = clip.lastFrame;
    this.setCurrent(clip);
    if (this.watchdog) clearTimeout(this.watchdog);
    return clip;
  }
}
