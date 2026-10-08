// Live sources are evaluated at render time, once per frame, so a clock can
// tick inside a single pre-rendered clip. They live in shared code because the
// editor preview needs to compute them too.
import type { PluginInfo, SourceInstance } from "./types";
import type { Scope } from "./bindings";
import { sunTimes } from "./sun";

export interface LivePlugin {
  info: PluginInfo;
  compute(config: Record<string, unknown>, epochMs: number): unknown;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFor(tz: string, epochMs: number) {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz || undefined,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "long",
      });
    } catch {
      fmt = new Intl.DateTimeFormat("en-US", { hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "long" });
    }
    fmtCache.set(tz, fmt);
  }
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(epochMs))) out[p.type] = p.value;
  return out;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A place for sunrise and sunset, in degrees (east and north positive). */
export interface Place {
  lat: number;
  lon: number;
}

/** The place in a source's config, if both its latitude and longitude are set. */
export function placeOf(config: Record<string, unknown>): Place | undefined {
  const set = (v: unknown) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
  return set(config.lat) && set(config.lon) ? { lat: Number(config.lat), lon: Number(config.lon) } : undefined;
}

/**
 * Day or night: from sunrise and sunset at `place`, or without one, day from
 * 6:00 to 18:00 local time.
 */
function daylight(tz: string, hour12: boolean, epochMs: number, H: number, place?: Place) {
  const at = (ms: number | null) => {
    if (ms === null) return "";
    const q = partsFor(tz, ms);
    const h = Number(q.hour) % 24;
    return hour12 ? `${h % 12 === 0 ? 12 : h % 12}:${q.minute}` : `${String(h).padStart(2, "0")}:${q.minute}`;
  };
  if (!place) return { isDay: H >= 6 && H < 18, sunrise: "", sunset: "" };
  const s = sunTimes(epochMs, place.lat, place.lon);
  const isDay = s.always ? s.always === "day" : epochMs >= s.rise! && epochMs < s.set!;
  return { isDay, sunrise: at(s.rise), sunset: at(s.set) };
}

export function clockValues(tz: string, hour12: boolean, epochMs: number, place?: Place) {
  const p = partsFor(tz, epochMs);
  const H = Number(p.hour) % 24;
  const h12 = H % 12 === 0 ? 12 : H % 12;
  const month = MONTHS[Number(p.month) - 1];
  const sec = Number(p.second);
  // Hour fields follow the source's 12/24-hour setting; H24 and h12 ignore it.
  const hour = hour12 ? h12 : H;
  const hh = hour12 ? String(h12) : String(H).padStart(2, "0");
  const { isDay, sunrise, sunset } = daylight(tz, hour12, epochMs, H, place);
  return {
    time: `${hh}:${p.minute}`,
    timeSec: `${hh}:${p.minute}:${p.second}`,
    hh,
    HH: String(hour).padStart(2, "0"),
    h: String(hour),
    H24: String(H).padStart(2, "0"),
    h12: String(h12),
    mm: p.minute,
    ss: p.second,
    ampm: H < 12 ? "AM" : "PM",
    colon: sec % 2 === 0 ? ":" : " ",
    weekday: p.weekday,
    wd: p.weekday.slice(0, 3),
    day: String(Number(p.day)),
    dd: p.day,
    month,
    mon: month.slice(0, 3),
    monthNum: p.month,
    year: p.year,
    date: `${month.slice(0, 3)} ${Number(p.day)}`,
    iso: `${p.year}-${p.month}-${p.day}`,
    hour: H,
    minute: Number(p.minute),
    second: sec,
    isDay,
    dayNight: isDay ? "day" : "night",
    /** An icon name: "sun" by day, "moon" by night. */
    icon: isDay ? "sun" : "moon",
    sunrise,
    sunset,
  };
}

export const clockPlugin: LivePlugin = {
  info: {
    id: "clock",
    name: "Clock & date",
    description: "Current time and date in a time zone, and whether it's day or night. Updates every frame, so seconds tick while a slide plays.",
    live: true,
    defaultAlias: "clock",
    defaultRefreshSec: 0,
    fields: [
      { key: "timezone", label: "Time zone", type: "timezone" },
      { key: "hour12", label: "12-hour clock", type: "boolean" },
      { key: "lat", label: "Latitude", type: "number", step: 0.0001, help: "For day and night by sunrise and sunset. Leave blank to count 6:00 to 18:00 as day." },
      { key: "lon", label: "Longitude", type: "number", step: 0.0001 },
    ],
    defaultConfig: { timezone: "UTC", hour12: false, lat: null, lon: null },
    sample: clockValues("UTC", false, Date.UTC(2026, 8, 27, 9, 41, 7)),
  },
  compute: (config, epochMs) => clockValues(String(config.timezone ?? ""), Boolean(config.hour12), epochMs, placeOf(config)),
};

export const LIVE_PLUGINS: Record<string, LivePlugin> = { clock: clockPlugin };

/**
 * Builds the binding scope at an instant: fetched data by alias, plus live
 * sources computed for that instant, and the instant itself as `$now` (for
 * drawing that follows the date, such as the moon's phase).
 */
export function buildScope(sources: SourceInstance[], fetched: Record<string, unknown>, epochMs: number): Scope {
  const scope: Scope = { $now: epochMs };
  for (const s of sources) {
    const live = LIVE_PLUGINS[s.plugin];
    scope[s.alias] = live ? live.compute(s.config, epochMs) : fetched[s.id];
  }
  return scope;
}

export function sourcesAreLive(sources: SourceInstance[]): boolean {
  return sources.some((s) => LIVE_PLUGINS[s.plugin]);
}
