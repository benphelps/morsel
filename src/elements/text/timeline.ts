import { resolveKeys, type Clock } from "../../shared/animate";
import type { Scope } from "../../shared/bindings";
import type { TimelineTrack } from "../types";
import { fillFinishMs, marqueeTiming, onceEndMs, onceSpeed, pingPongCycleMs, restMs, scrollExtent, scrollTime, slideTimeAt, type TextElement } from "./element";

const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

const LABELS = { pingpong: "Scrolls there and back, until the Hold ends", loop: "Scrolls round, until the Hold ends" };

/**
 * The Scroll row inside a Hold (a rotator item, a fitted slide), drawn from
 * the text's settings alone so it looks the same whatever the data: the flag
 * at "Start after", from the start of the Hold, and a bar on to the Hold's
 * end. A "once" scroll goes at its speed, and the Hold lasts as long as it
 * takes, so it has no end to drag.
 */
export function holdTracks(el: TextElement, [a, b]: [number, number]): TimelineTrack<TextElement>[] {
  const mode = el.marqueeMode ?? "loop";
  const timing = marqueeTiming(el);
  const start = Math.min(b, a + timing.startMs);
  const title = mode === "once" ? `Scrolls at ${el.marqueeSpeed} px/s, then rests ${secs(restMs(el))}. The Hold lasts as long as that takes.` : LABELS[mode];
  return [
    {
      id: "scroll",
      label: "Scroll",
      spans: [{ start, end: b, title }],
      markers: [
        {
          id: "start",
          t: start,
          shape: "start",
          title: `Starts scrolling ${secs(timing.startMs)} into the Hold. Drag to change.`,
          move: (x, t) => void (x.marqueeDelayMs = Math.max(0, Math.round(t - a))),
        },
      ],
    },
  ];
}

/**
 * Scrolling text's own timeline row: a flag where the scroll starts (drag to
 * set "Start after") and a bar for how long it scrolls. "Once" also gets an
 * end marker (drag it to set the speed, or filling the time, the rest after
 * it) and a faded bar for the rest.
 */
export function textTracks(raw: TextElement, scope: Scope, clock: Clock): TimelineTrack<TextElement>[] {
  if (raw.overflow !== "marquee") return [];
  if (clock.hold) return holdTracks(raw, clock.hold);
  // Measured with every key at its time on this timeline (exits may count from its end).
  const el = resolveKeys(raw, clock.end);
  const scrollClock = (x: TextElement, t: number) => scrollTime(resolveKeys(x, clock.end), t);
  const mode = el.marqueeMode ?? "loop";
  const timing = marqueeTiming(el);
  // Along the scroll: the widest line and the box's width, or scrolling up, the text's height and the box's.
  const { content: widest, box } = scrollExtent(el, scope);
  const fits = widest <= box;
  const start = slideTimeAt(el, timing.startMs);

  const track: TimelineTrack<TextElement> = {
    id: "scroll",
    label: "Scroll",
    spans: [],
    markers: [
      {
        id: "start",
        t: start,
        shape: "start",
        title: `Scrolling starts at ${secs(start)}${fits ? " (the text fits right now, so it won't move)" : ""}`,
        // The delay counts scroll time, which pauses during moves if the text waits for them.
        move: (x, t) => void (x.marqueeDelayMs = Math.max(0, Math.round(scrollClock(x, t)))),
      },
    ],
  };

  if (mode === "once") {
    // Filling the time: where it's meant to finish. Where it really does (the speed cap can make it late), then its rest.
    const fill = fillFinishMs(el, clock);
    const planned = fill != null ? slideTimeAt(el, fill) : null;
    const actual = fits ? start : slideTimeAt(el, onceEndMs(el, widest, box, clock));
    const end = planned ?? actual;
    const rest = restMs(el);
    track.spans.push({ start, end });
    if (planned != null && actual > planned + 1)
      track.spans.push({ start: planned, end: actual, faded: true, title: `This text needs more than ${Math.round(onceSpeed(el, widest, box, clock))} px/s, the speed cap, so it finishes at ${secs(actual)}` });
    else if (!fits && rest) track.spans.push({ start: actual, end: Math.min(clock.end, actual + rest), faded: true, title: `Rests ${secs(rest)} so it can be read` });
    const distance = widest - box;
    track.markers.push({
      id: "end",
      t: end,
      shape: "end",
      title:
        fill != null
          ? `Fills the time: finishes at ${secs(end)}, resting ${secs(rest)} before ${clock.outroMs ? "the outro" : "the end"}. Drag to change the rest.`
          : `Reaches the end at ${secs(actual)} at ${el.marqueeSpeed} px/s. Drag to change the speed.`,
      move: (x, t) => {
        if (x.marqueeFill) {
          // The rest is what's left between here and the outro line (or the end).
          x.marqueeRestMs = Math.max(0, Math.round(scrollClock(x, clock.end - clock.outroMs) - scrollClock(x, t)));
        } else if (distance > 0) {
          // The speed that gets this text to its end here.
          const took = Math.max(100, scrollClock(x, t) - marqueeTiming(x).startMs);
          x.marqueeSpeed = Math.max(1, Math.min(200, Math.round((distance / took) * 1000)));
        }
      },
    });
  } else {
    // Ping-pong: one round trip. Loop: for good.
    const end = fits ? start : mode === "pingpong" ? slideTimeAt(el, pingPongCycleMs(widest, box, el.marqueeSpeed, timing)) : null;
    track.spans.push({ start, end });
  }
  return [track];
}
