import type { Frame } from "../shared/render";
import { HEIGHT, WIDTH } from "../shared/types";

export type LedMode = "led" | "pixel";

/**
 * Paints a panel frame like the real hardware: round dots with dim unlit
 * pixels. (ox, oy) is where the panel's top-left lands on the canvas.
 */
export function paintFrame(ctx: CanvasRenderingContext2D, frame: Frame, zoom: number, mode: LedMode = "led", ox = 0, oy = 0) {
  const w = WIDTH * zoom;
  const h = HEIGHT * zoom;
  ctx.fillStyle = "#07080a";
  ctx.fillRect(ox, oy, w, h);
  if (mode === "pixel" || zoom < 4) {
    paintPixels(ctx, frame, WIDTH, HEIGHT, zoom, ox, oy);
    return;
  }
  // The Tidbyt's LEDs fill a bit over half of each pixel's pitch.
  const r = zoom * 0.3;
  ctx.fillStyle = "#16191e";
  ctx.beginPath();
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      if (frame[i] + frame[i + 1] + frame[i + 2] < 24) {
        const cx = ox + x * zoom + zoom / 2;
        const cy = oy + y * zoom + zoom / 2;
        ctx.moveTo(cx + r, cy);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
    }
  ctx.fill();
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const R = frame[i];
      const G = frame[i + 1];
      const B = frame[i + 2];
      if (R + G + B < 24) continue;
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.beginPath();
      ctx.arc(ox + x * zoom + zoom / 2, oy + y * zoom + zoom / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
}

/** Paints a frame of any size as hard-edged squares. */
export function paintPixels(ctx: CanvasRenderingContext2D, frame: Frame, fw: number, fh: number, zoom: number, ox = 0, oy = 0) {
  const tmp = scratch(fw, fh);
  const img = new ImageData(fw, fh);
  img.data.set(frame);
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, ox, oy, fw * zoom, fh * zoom);
}

const scratches = new Map<string, HTMLCanvasElement>();
function scratch(w: number, h: number) {
  const key = `${w}x${h}`;
  let c = scratches.get(key);
  if (!c) {
    if (scratches.size > 8) scratches.clear();
    c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    scratches.set(key, c);
  }
  return c;
}
