import { lookup, numericSeriesPaths, resolveNumber, resolveSeries, type Scope } from "../../shared/bindings";
import { parseColor } from "../../shared/color";
import type { ElementBase } from "../../shared/types";
import type { ElementDef } from "../types";

export interface SparklineElement extends ElementBase {
  type: "sparkline";
  /** A binding to an array of numbers ({{stocks.GSPC.series}}) or literal "3, 5, 4". */
  data: string;
  style: "line" | "area" | "bars";
  /** "fixed" uses state.color; "trend" picks up/down colour by where the series ends. */
  colorMode: "fixed" | "trend";
  upColor: string;
  downColor: string;
  /** Optional reference value (binding or number), e.g. {{stocks.GSPC.prevClose}}. Trend compares against it, else the first value. */
  baseline: string;
  showBaseline: boolean;
  /** Mark the latest value with a bright dot. */
  showLast: boolean;
  /** Draw the line in from left to right over this many ms from the slide's start; 0 = off. */
  revealMs: number;
}

/** A series' previous close as a binding, when the data has one next to it. */
export function prevCloseFor(dataBinding: string, scope: Scope): string | null {
  const path = dataBinding.replace(/^\{\{\s*|\s*\}\}$/g, "");
  const parent = path.split(".").slice(0, -1).join(".");
  return parent && typeof lookup(scope, `${parent}.prevClose`) === "number" ? `{{${parent}.prevClose}}` : null;
}

/**
 * Points the sparkline at new data. A reference value that was the old data's
 * previous close (or blank) follows to the new data's, so it never ends up
 * measuring one series against another's close, e.g. a $330 stock against the
 * S&P's 7,700, which squashes the line flat.
 */
export function setSparklineData(el: SparklineElement, data: string, scope: Scope) {
  const auto = !el.baseline.trim() || el.baseline === prevCloseFor(el.data, scope) || /^\{\{\s*[\w.]+\.prevClose\s*\}\}$/.test(el.baseline);
  el.data = data;
  if (auto) el.baseline = prevCloseFor(data, scope) ?? "";
}

const BASELINE_GREY = [108, 122, 138];

export const sparklineElement: ElementDef<SparklineElement> = {
  type: "sparkline",
  label: "Sparkline",
  group: "data",
  icon: "M1.5 11l3-4 3 3 3-6.5 4 5",
  create(scope = {}) {
    // Start on the first series in the data (inside a rotator, the item's), against its previous close if it has one.
    const paths = numericSeriesPaths(scope);
    const path = paths.find((x) => x.startsWith("item.")) ?? paths[0];
    const data = path ? `{{${path}}}` : "";
    return {
      data,
      style: "line",
      colorMode: "trend",
      upColor: "#32d46a",
      downColor: "#ff4040",
      baseline: (data && prevCloseFor(data, scope)) || "",
      showBaseline: true,
      showLast: true,
      revealMs: 0,
      state: { x: 2, y: 8, w: 60, h: 16, color: "#3aa0ff", opacity: 1 },
    };
  },
  draw(p, el, s, { t, scope }) {
    if (s.w < 1 || s.h < 1) return;
    const box = p.box(s);
    const a = s.opacity;
    const values = resolveSeries(el.data, scope);
    if (values.length < 2) {
      // Nothing to plot yet: a faint dotted midline keeps the element findable.
      const [r, g, b] = parseColor(s.color);
      for (let x = 0; x < s.w; x += 2) box.px(s.x + x, s.y + Math.floor(s.h / 2), r, g, b, a * 0.35);
      return;
    }
    const base = resolveNumber(el.baseline, scope);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (base != null && el.showBaseline) {
      lo = Math.min(lo, base);
      hi = Math.max(hi, base);
    }
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const last = values[values.length - 1];
    const [r, g, b] = el.colorMode === "trend" ? parseColor(last >= (base ?? values[0]) ? el.upColor : el.downColor) : parseColor(s.color);
    const bottom = s.y + s.h - 1;
    const yOf = (v: number) => bottom - Math.round(((v - lo) / (hi - lo)) * (s.h - 1));
    /** The series sampled at column `col` of `cols`, interpolating between points. */
    const at = (col: number, cols: number) => {
      const pos = cols <= 1 ? values.length - 1 : (col / (cols - 1)) * (values.length - 1);
      const i = Math.floor(pos);
      return i >= values.length - 1 ? last : values[i] + (values[i + 1] - values[i]) * (pos - i);
    };
    const shown = el.revealMs > 0 ? Math.min(1, Math.max(0, t / el.revealMs)) : 1;

    if (el.showBaseline && base != null) {
      const by = yOf(base);
      for (let x = 0; x < s.w; x += 2) box.px(s.x + x, by, BASELINE_GREY[0], BASELINE_GREY[1], BASELINE_GREY[2], a);
    }

    if (el.style === "bars") {
      // 1px bars with 1px gaps, spread across the box.
      const count = Math.max(1, Math.min(values.length, Math.floor((s.w + 1) / 2)));
      const visible = Math.ceil(count * shown);
      for (let i = 0; i < visible; i++) {
        const x = s.x + (count === 1 ? 0 : Math.round((i * (s.w - 1)) / (count - 1)));
        for (let y = yOf(at(i, count)); y <= bottom; y++) box.px(x, y, r, g, b, a);
      }
      return;
    }

    const cols = Math.max(1, Math.round(s.w * shown));
    let prevY: number | null = null;
    let endY = bottom;
    for (let c = 0; c < cols; c++) {
      const y = yOf(at(c, s.w));
      const x = s.x + c;
      if (el.style === "area") for (let yy = y + 1; yy <= bottom; yy++) box.px(x, yy, r, g, b, a * 0.3);
      // Join steep moves with a vertical run so the line never breaks.
      const from = prevY == null ? y : y > prevY ? prevY + 1 : y < prevY ? prevY - 1 : y;
      for (let yy = Math.min(from, y); yy <= Math.max(from, y); yy++) box.px(x, yy, r, g, b, a);
      prevY = y;
      endY = y;
    }
    if (el.showLast) box.px(s.x + cols - 1, endY, 255, 255, 255, a);
  },
  bindable: ["data", "baseline"],
};
