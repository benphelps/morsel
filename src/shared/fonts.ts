import { FONT_DATA } from "./fontdata";

export interface Glyph {
  advance: number;
  w: number;
  h: number;
  xoff: number;
  yoff: number;
  /** Row-major bitmap, 1 = lit. */
  bits: Uint8Array;
}

export interface Font {
  id: string;
  label: string;
  ascent: number;
  descent: number;
  lineHeight: number;
  glyph(cp: number): Glyph | null;
}

const cache = new Map<string, Font>();

// Stand-ins for glyphs a small font lacks, so text degrades to something readable.
const ASCII_FALLBACK: Record<number, number> = {
  0x2190: 60, // ← <
  0x2192: 62, // → >
  0x2191: 94, // ↑ ^
  0x2193: 118, // ↓ v
  0x2018: 39,
  0x2019: 39,
  0x201c: 34,
  0x201d: 34,
  0x2013: 45,
  0x2014: 45,
  0x2022: 42, // • *
  0x00b7: 46,
  // Spleen has no Ukrainian Є/є; the Latin shapes read the same.
  0x0404: 69,
  0x0454: 101,
  // Special spaces (macOS writes "9:00 PM" with a narrow no-break space).
  0x00a0: 32,
  0x2007: 32,
  0x2009: 32,
  0x200a: 32,
  0x202f: 32,
};

function decodeGlyph(spec: string): Glyph {
  const [dw, w, h, xoff, yoff, hex = ""] = spec.split(",");
  const W = Number(w);
  const H = Number(h);
  const nib = Math.ceil(W / 8) * 2;
  const bits = new Uint8Array(W * H);
  for (let row = 0; row < H; row++) {
    const rowHex = hex.slice(row * nib, row * nib + nib);
    for (let col = 0; col < W; col++) {
      const nibble = parseInt(rowHex[col >> 2] ?? "0", 16);
      bits[row * W + col] = (nibble >> (3 - (col & 3))) & 1;
    }
  }
  return { advance: Number(dw), w: W, h: H, xoff: Number(xoff), yoff: Number(yoff), bits };
}

export const DEFAULT_FONT = "tb-8";

export function getFont(id: string): Font {
  const key = FONT_DATA[id] ? id : DEFAULT_FONT;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = FONT_DATA[key];
  const glyphs = new Map<number, Glyph>();
  const font: Font = {
    id: key,
    label: data.label,
    ascent: data.ascent,
    descent: data.descent,
    lineHeight: data.ascent + data.descent,
    glyph(cp) {
      let g = glyphs.get(cp);
      if (g) return g;
      let spec = data.glyphs[cp];
      // Fonts without lowercase (CG pixel) fall back to uppercase.
      if (!spec && cp >= 97 && cp <= 122) spec = data.glyphs[cp - 32];
      if (!spec && ASCII_FALLBACK[cp]) spec = data.glyphs[ASCII_FALLBACK[cp]];
      if (!spec && cp === 0xb0) {
        // No degree sign (the tiny CG fonts): a 3×3 ring at cap height.
        g = { advance: 4, w: 3, h: 3, xoff: 0, yoff: data.ascent - 3, bits: Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]) };
        glyphs.set(cp, g);
        return g;
      }
      if (!spec) spec = data.glyphs[63]; // "?"
      if (!spec) return null;
      g = decodeGlyph(spec);
      glyphs.set(cp, g);
      return g;
    },
  };
  cache.set(key, font);
  return font;
}

export function listFonts(): { id: string; label: string; lineHeight: number }[] {
  return Object.entries(FONT_DATA).map(([id, f]) => ({ id, label: f.label, lineHeight: f.ascent + f.descent }));
}

export function measureLine(font: Font, text: string): number {
  let w = 0;
  for (const ch of text) w += font.glyph(ch.codePointAt(0)!)?.advance ?? 0;
  return w;
}
