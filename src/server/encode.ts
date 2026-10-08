import sharp from "sharp";
import type { Clip } from "../shared/clip";
import { HEIGHT, WIDTH } from "../shared/types";

/**
 * The firmware only notices an "immediate" interrupt between frames, so a long
 * held frame in an animation delays notifications. Split holds into chunks;
 * repeated frames cost only a few bytes each in an animated WebP.
 */
const MAX_FRAME_MS = 400;

/** Encodes a clip as a (possibly animated) lossless WebP. */
export async function encodeWebp(clip: Clip): Promise<Buffer> {
  if (clip.frames.length === 1) {
    const f = clip.frames[0];
    // Single stills are held by the firmware in 100ms slices, so they stay interruptible.
    return sharp(Buffer.from(f.buffer, f.byteOffset, f.byteLength), { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
      .webp({ lossless: true })
      .toBuffer();
  }
  const frames: Buffer[] = [];
  const delays: number[] = [];
  clip.frames.forEach((f, i) => {
    const buf = Buffer.from(f.buffer, f.byteOffset, f.byteLength);
    let left = clip.delays[i];
    let k = 0;
    while (left > 0) {
      const d = left > MAX_FRAME_MS * 1.5 ? MAX_FRAME_MS : left;
      // libwebp folds identical frames back together, so nudge the lowest bit
      // of one pixel's blue on alternate copies. Invisible on the panel.
      let copy = buf;
      if (k++ % 2 === 1) {
        copy = Buffer.from(buf);
        copy[2] ^= 1;
      }
      frames.push(copy);
      delays.push(d);
      left -= d;
    }
  });
  return sharp(Buffer.concat(frames), { raw: { width: WIDTH, height: HEIGHT * frames.length, channels: 4, pageHeight: HEIGHT } as any })
    .webp({ lossless: true, loop: 0, delay: delays, effort: 4 })
    .toBuffer();
}

/** Gen 1 firmware refuses images over CONFIG_HTTP_BUFFER_SIZE_MAX (460000). */
export const DEVICE_MAX_BYTES = 460_000;
