import type { SlideElement } from "../elements";
import type { Timing } from "./timing";

export const WIDTH = 64;
export const HEIGHT = 32;

export type EasingName =
  | "linear"
  | "step"
  | "easeInQuad"
  | "easeOutQuad"
  | "easeInOutQuad"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeInBack"
  | "easeOutBack"
  | "easeOutBounce"
  | "easeOutElastic";

/** The animatable part of an element. A keyframe always stores all of it. */
export interface AnimState {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string; // #rrggbb
  opacity: number; // 0..1
}

/** The groups of AnimState that can be keyed on their own (see CHANNEL_FIELDS). */
export type Channel = "position" | "size" | "color" | "opacity";

export interface Keyframe {
  id: string;
  /**
   * Milliseconds from the start of its timeline (the slide's, or a rotator
   * item's), or with `fromEnd`, before that timeline's end.
   */
  t: number;
  /**
   * Counts back from the end: it sits after its timeline's outro line (see
   * Slide.outroMs), so it keeps its place before the end however long the
   * slide or item turns out to be.
   */
  fromEnd?: boolean;
  /**
   * Easing used to travel from the previous keyframe into this one (the
   * previous one on the same channel, when keyed separately).
   */
  easing: EasingName;
  /** Always a whole state; a channel keyframe only uses its channel's fields. */
  state: AnimState;
  /** Keys just this channel. Missing: keys every channel (the "together" mode). */
  channel?: Channel;
}

/** A colour chosen by a number: above, below or at a threshold. */
export interface ColorFrom {
  /** A binding to a number, e.g. {{item.change}}. */
  value: string;
  /** Missing means 0. */
  threshold?: number;
  above: string;
  below: string;
  /** At the threshold exactly; missing uses `above`. */
  equal?: string;
}

/** Fields every element has, whatever its type. */
export interface ElementBase {
  id: string;
  name: string;
  hidden?: boolean;
  locked?: boolean;
  /** Keep width:height when resizing. Shift while dragging a handle flips it. */
  lockAspect?: boolean;
  /**
   * Only draw when this binding has a value, e.g. "{{notify.image}}"; prefix
   * with "!" to draw only when it's empty. Blank means always.
   */
  showIf?: string;
  /**
   * Colour from data: a number picks the colour, e.g. green while a stock's
   * {{item.change}} is above 0 and red below. It replaces the (keyframed)
   * colour; everything else still animates.
   */
  colorFrom?: ColorFrom;
  /** Used when the element has no keyframes (for a channel with none, when keyed separately). */
  state: AnimState;
  keyframes: Keyframe[];
  /**
   * "together" (the default): each keyframe keys the whole state. "separate":
   * position, size, colour and opacity each have their own keyframes and timing.
   */
  keyMode?: "together" | "separate";
}

// The element types themselves live in src/elements/, one folder each.
export type { ElementType, SlideElement } from "../elements";

export type TransitionType =
  | "cut"
  | "crossfade"
  | "fadeBlack"
  | "push"
  | "cover"
  | "reveal"
  | "wipe"
  | "dissolve"
  | "blinds";
export type Direction = "left" | "right" | "up" | "down";

export interface Transition {
  type: TransitionType;
  durationMs: number;
  easing: EasingName;
  direction: Direction;
}

export type SystemKind = "nowplaying" | "notification" | "message" | "dnd";

/** Do Not Disturb: pause the deck and show one slide. Runtime state, kept outside the project file. */
export interface DndState {
  enabled: boolean;
  /** Epoch ms when it switches itself off; null = until turned off. */
  until: number | null;
  /** A library slide to show instead of the "Do Not Disturb" system slide. */
  slideId: string | null;
  /** Brightness while on (0–100); null keeps the normal brightness. */
  brightness: number | null;
  /** Hold back notifications and Now Playing while on. */
  muteNotifications: boolean;
}

/** A slide's timing (fixed length or fit to content, see Timing) is shared with a rotator's items. */
export interface Slide extends Timing {
  id: string;
  name: string;
  /** Set on the editable templates used for notifications; they never join a deck. */
  system?: SystemKind;
  /** Extra binding values for this slide only (a notification's {{notify.*}}). */
  scope?: Record<string, unknown>;
  /**
   * Whole seconds: the firmware's dwell timer only understands seconds. With
   * `fit`, what it falls back to; the slide really plays as long as settleSlide says.
   */
  durationSec: number;
  background: string;
  /** How this slide enters from whatever was showing before it. */
  transition: Transition;
  elements: SlideElement[];
}

export interface DeckItem {
  id: string;
  slideId: string;
  enabled: boolean;
  /** Only play while this binding has a value, e.g. "{{calendar.hasEvents}}"; "!" inverts. */
  showIf?: string;
}

export interface Deck {
  id: string;
  name: string;
  items: DeckItem[];
}

export interface SourceInstance {
  id: string;
  /** The name used in bindings, e.g. "weather" in {{weather.temp}}. */
  alias: string;
  plugin: string;
  config: Record<string, unknown>;
  /** Seconds between fetches; ignored by live plugins such as the clock. */
  refreshSec: number;
}

export interface DeviceSettings {
  brightness: number; // 0..100
  night: {
    enabled: boolean;
    start: string; // "22:00"
    end: string; // "07:00"
    brightness: number;
  };
  /** IANA time zone used for schedules; clocks carry their own. */
  timezone: string;
}

export interface Project {
  version: 1;
  fps: number;
  slides: Slide[];
  decks: Deck[];
  activeDeckId: string;
  sources: SourceInstance[];
  device: DeviceSettings;
  /** Templates for notifications, one per SystemKind. */
  systemSlides?: Slide[];
}

/* ---- Plugin metadata (shared so the editor can build config forms) ---- */

export type ConfigField =
  | { key: string; label: string; type: "string"; placeholder?: string; help?: string; secret?: boolean }
  | { key: string; label: string; type: "number"; min?: number; max?: number; step?: number; help?: string }
  | { key: string; label: string; type: "boolean"; help?: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; help?: string }
  | { key: string; label: string; type: "timezone"; help?: string };

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  /** Live plugins are computed per frame (e.g. clocks) instead of fetched. */
  live: boolean;
  /** Push plugins never fetch: another app sends their data (POST /api/push/:plugin). */
  push?: boolean;
  defaultAlias: string;
  defaultRefreshSec: number;
  fields: ConfigField[];
  defaultConfig: Record<string, unknown>;
  /** Example output so bindings can be written before the first fetch. */
  sample: unknown;
}

export interface SourceStatus {
  id: string;
  data: unknown;
  updatedAt: number | null;
  error: string | null;
}

export interface DeviceStatus {
  connected: boolean;
  transport: "websocket" | "http" | null;
  lastSeen: number | null;
  clientInfo: Record<string, unknown> | null;
  /** `clip` names the rendered clip (see /api/device/clip/:id.webp); `since` is when the device started it. */
  current: { clip: string; slideId: string | null; name: string; since: number; bytes: number; frames: number } | null;
  dnd?: DndState;
  queued: { clip: string; slideId: string | null; name: string } | null;
}
