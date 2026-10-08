import { useEffect, useRef, useState } from "react";
import type { Frame } from "../../shared/render";
import { HEIGHT, WIDTH } from "../../shared/types";
import { paintFrame } from "../led";

// What the device is showing, played in step with it: the clip it was sent,
// decoded frame by frame and shown at the point the device has reached, i.e.
// the time since it started the clip (on the server's clock), looping as the
// firmware does. A plain animated <img> would start from the first frame
// whenever it happened to load.

const ZOOM = 7;

interface Clip {
  frames: Frame[];
  /** When each frame ends, in ms from the start of the clip. */
  ends: number[];
  /** When the device started it, on the server's clock. */
  since: number;
}

/** The frames of an (animated) WebP, or null where the browser can't decode them one by one. */
async function decodeWebp(data: ArrayBuffer): Promise<Omit<Clip, "since"> | null> {
  const Decoder = (window as any).ImageDecoder;
  if (!Decoder || !(await Decoder.isTypeSupported("image/webp"))) return null;
  const decoder = new Decoder({ data, type: "image/webp" });
  try {
    // The track (and so the frame count) is only known once the decoder has read the header.
    await decoder.tracks.ready;
    await decoder.completed;
    const count: number = decoder.tracks.selectedTrack?.frameCount ?? 1;
    const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const frames: Frame[] = [];
    const ends: number[] = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.drawImage(image, 0, 0);
      t += (image.duration ?? 0) / 1000; // µs
      image.close();
      frames.push(ctx.getImageData(0, 0, WIDTH, HEIGHT).data);
      ends.push(t);
    }
    return { frames, ends };
  } finally {
    decoder.close();
  }
}

/** The frame showing `elapsed` ms into a clip that loops. */
function frameAt(clip: Clip, elapsed: number): number {
  const total = clip.ends[clip.ends.length - 1];
  if (!(total > 0)) return 0;
  const t = ((elapsed % total) + total) % total;
  let lo = 0;
  let hi = clip.ends.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (clip.ends[mid] > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// Decoded clips by id: the one showing, and the next one, fetched while this
// one plays so the switch is instant. Ids are never reused, so entries never go stale.
const decoded = new Map<string, Promise<Omit<Clip, "since"> | null>>();
const KEEP = 4;

function loadClip(id: string) {
  let clip = decoded.get(id);
  if (!clip) {
    clip = fetch(`/api/device/clip/${id}.webp`)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then(decodeWebp);
    // A failed fetch (the clip was dropped from the queue) may be tried again later.
    clip.catch(() => decoded.delete(id));
    decoded.set(id, clip);
    for (const old of decoded.keys()) if (decoded.size > KEEP && old !== id) decoded.delete(old);
  }
  return clip;
}

/**
 * @param clip the clip on the display, and `since`, when the device started it (server clock)
 * @param next the clip queued after it, fetched ahead of time
 * @param clockOffset server clock minus this browser's
 */
export function DeviceMirror({ clip: current, since, next, clockOffset }: { clip: string; since: number; next?: string; clockOffset: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [fallback, setFallback] = useState(false);
  const offset = useRef(clockOffset);
  offset.current = clockOffset;

  useEffect(() => {
    let alive = true;
    loadClip(current).then(
      (frames) => {
        if (!alive) return;
        if (!frames) return setFallback(true);
        setClip({ ...frames, since });
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [current, since]);

  useEffect(() => {
    if (next && !fallback) void loadClip(next).catch(() => {});
  }, [next, fallback]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !clip) return;
    let shown = -1;
    let raf = 0;
    const tick = () => {
      const i = frameAt(clip, Date.now() + offset.current - clip.since);
      if (i !== shown) paintFrame(ctx, clip.frames[(shown = i)], ZOOM, "led");
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [clip]);

  if (fallback) return <img src={`/api/device/clip/${current}.webp`} alt="What the device is showing" width={WIDTH * ZOOM} height={HEIGHT * ZOOM} />;
  return <canvas ref={canvas} role="img" aria-label="What the device is showing" width={WIDTH * ZOOM} height={HEIGHT * ZOOM} />;
}
