import { elementDef, type ElementOfType, type ElementType } from "../elements";
import type { Scope } from "./bindings";
import { uid } from "./id";
import STARTER from "./starter.json";
import type { Deck, Project, Slide, SourceInstance, Transition } from "./types";

export const DEFAULT_TRANSITION: Transition = { type: "push", durationMs: 500, easing: "easeOutCubic", direction: "left" };

/**
 * A new element of any type: its type's defaults, then `extra` on top.
 * `scope` is the current data, which some types use to pick a starting binding.
 */
export function createElement<T extends ElementType>(type: T, extra: Partial<ElementOfType<T>> = {}, scope?: Scope): ElementOfType<T> {
  const def = elementDef(type);
  return { id: uid("el_"), type, name: def.label, keyframes: [], ...def.create(scope), ...extra } as unknown as ElementOfType<T>;
}

export function createSlide(name = "Untitled slide"): Slide {
  return { id: uid("sl_"), name, durationSec: 8, background: "#000000", transition: { ...DEFAULT_TRANSITION }, elements: [] };
}

export function createDeck(name = "Main"): Deck {
  return { id: uid("dk_"), name, items: [] };
}

/** A fresh copy of the starter slides, every id new. */
function starterSlides(): Slide[] {
  const fresh = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fresh);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = k === "id" && typeof x === "string" ? uid(x.slice(0, x.indexOf("_") + 1)) : fresh(x);
    return out;
  };
  return fresh(STARTER) as Slide[];
}

/**
 * A new project: a deck showing off what slides can do (a clock, the weather,
 * stocks, the news and, from the Mac app, the next meeting), with the sources
 * they use. Slides whose data isn't set up yet, or isn't there, sit out until it is.
 */
export function createProject(timezone = "UTC"): Project {
  const source = (alias: string, plugin: string, config: Record<string, unknown>, refreshSec: number): SourceInstance => ({ id: uid("src_"), alias, plugin, config, refreshSec });
  const sources = [
    source("clock", "clock", { timezone, hour12: false, lat: null, lon: null }, 0),
    source("weather", "weather", { location: "", lat: null, lon: null, units: "celsius" }, 900),
    source("stocks", "stocks", { symbols: "AAPL, MSFT, ^GSPC" }, 60),
    source("gnews", "googlenews", { query: "", when: "1d", edition: "US:en", max: 8 }, 900),
    source("calendar", "mac-calendar", {}, 0),
  ];
  const slides = starterSlides();
  // Each slide's "play only when": the weather once a place is set, the news once it's in, the calendar while there's a meeting.
  const only: Record<string, string> = { Weather: "{{weather.condition}}", News: "{{gnews.count}}", Calendar: "{{calendar.hasEvents}}" };
  const deck = createDeck("Main");
  deck.items = slides.map((s) => ({ id: uid("di_"), slideId: s.id, enabled: true, ...(only[s.name] && { showIf: only[s.name] }) }));
  return {
    version: 1,
    fps: 20,
    slides,
    decks: [deck],
    activeDeckId: deck.id,
    sources,
    device: { brightness: 40, night: { enabled: false, start: "22:00", end: "07:00", brightness: 5 }, timezone },
  };
}
