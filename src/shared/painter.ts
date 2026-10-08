import { HEIGHT, WIDTH } from "./types";

/** Opaque RGBA pixels covering a View; for the panel, WIDTH * HEIGHT * 4 bytes. */
export type Frame = Uint8ClampedArray;

/** The region of slide space a frame covers. The panel itself is PANEL_VIEW. */
export interface View {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export const PANEL_VIEW: View = { x0: 0, y0: 0, w: WIDTH, h: HEIGHT };

export interface Clip {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number;
}

const UNCLIPPED: Clip = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };

/** What elements draw with: blends pixels in slide coordinates onto a frame. */
export class Painter {
  constructor(
    public f: Frame,
    public view: View = PANEL_VIEW,
    public clip: Clip = UNCLIPPED,
    /** Multiplies every pixel's alpha: a container fading its children as one. */
    public alpha = 1,
  ) {}

  /** Blends a colour onto the frame at slide coordinates (x, y) with alpha 0..1. */
  px(x: number, y: number, r: number, g: number, b: number, a: number) {
    a *= this.alpha;
    if (a <= 0) return;
    if (x < this.clip.x0 || y < this.clip.y0 || x >= this.clip.x1 || y >= this.clip.y1) return;
    const lx = x - this.view.x0;
    const ly = y - this.view.y0;
    if (lx < 0 || ly < 0 || lx >= this.view.w || ly >= this.view.h) return;
    const i = (ly * this.view.w + lx) * 4;
    const f = this.f;
    if (a >= 1) {
      f[i] = r;
      f[i + 1] = g;
      f[i + 2] = b;
    } else {
      f[i] += (r - f[i]) * a;
      f[i + 1] += (g - f[i + 1]) * a;
      f[i + 2] += (b - f[i + 2]) * a;
    }
    f[i + 3] = 255;
  }

  /** A painter that only draws inside `c` (and this painter's own clip). */
  clipped(c: Clip): Painter {
    return new Painter(
      this.f,
      this.view,
      {
        x0: Math.max(this.clip.x0, c.x0),
        y0: Math.max(this.clip.y0, c.y0),
        x1: Math.min(this.clip.x1, c.x1),
        y1: Math.min(this.clip.y1, c.y1),
      },
      this.alpha,
    );
  }

  /** A painter whose (0, 0) is at (dx, dy) here: how a container draws its children in their own coordinates. */
  translate(dx: number, dy: number): Painter {
    if (!dx && !dy) return this;
    const { view, clip } = this;
    return new Painter(this.f, { ...view, x0: view.x0 - dx, y0: view.y0 - dy }, { x0: clip.x0 - dx, y0: clip.y0 - dy, x1: clip.x1 - dx, y1: clip.y1 - dy }, this.alpha);
  }

  /** A painter drawing at k times the opacity. */
  fade(k: number): Painter {
    return k >= 1 ? this : new Painter(this.f, this.view, this.clip, this.alpha * Math.max(0, k));
  }

  /** Clipped to an element's box. */
  box(s: { x: number; y: number; w: number; h: number }): Painter {
    return this.clipped({ x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h });
  }
}
