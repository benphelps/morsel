// The editor's UI icons: small inline SVGs on a 16×16 grid, drawn with
// currentColor so they follow the text colour. Emoji and symbol characters
// render differently per platform (🔒 comes out in full colour), these don't.

/** Stroked path data, or filled shapes where marked. */
const ICONS = {
  lock: { d: "M4 7.5h8v6H4z M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2" },
  unlock: { d: "M4 7.5h8v6H4z M5.5 7.5V5.5a2.5 2.5 0 0 1 4.8-1" },
  eye: { d: "M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z M8 6.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6z" },
  eyeOff: { d: "M2.5 2.5l11 11 M6.6 6.7a1.8 1.8 0 0 0 2.6 2.5 M4.3 5.1C2.5 6.3 1.5 8 1.5 8s2.4 4.5 6.5 4.5c1.1 0 2.1-.3 3-.8 M7 3.6l1-.1c4.1 0 6.5 4.5 6.5 4.5s-.5.9-1.4 2" },
  play: { d: "M4.5 2.8v10.4L13 8z", fill: true },
  pause: { d: "M4 3h2.8v10H4z M9.2 3H12v10H9.2z", fill: true },
  undo: { d: "M3.5 6.5h6a3.5 3.5 0 0 1 0 7H6 M6.2 3.5L3.2 6.5l3 3" },
  redo: { d: "M12.5 6.5h-6a3.5 3.5 0 0 0 0 7H10 M9.8 3.5l3 3-3 3" },
  reset: { d: "M2.8 8a5.2 5.2 0 1 0 1.5-3.7L2.5 6 M2.5 2.5V6H6" },
  duplicate: { d: "M5.5 5.5h8v8h-8z M10.5 5.5v-3h-8v8h3" },
  close: { d: "M4 4l8 8 M12 4l-8 8" },
  check: { d: "M3 8.5l3 3 7-7" },
  moon: { d: "M13.2 9.6A5.6 5.6 0 1 1 6.4 2.8a4.4 4.4 0 0 0 6.8 6.8z" },
  keyframe: { d: "M8 2.3L13.7 8 8 13.7 2.3 8z", fill: true },
  grip: { d: "M6 3.5h.01 M10 3.5h.01 M6 8h.01 M10 8h.01 M6 12.5h.01 M10 12.5h.01", width: 2.4 },
  slide: { d: "M1.5 4.5h13v7h-13z M4.5 8h.01 M8 8h.01 M11.5 8h.01", width: 1.6 },
  alignLeft: { d: "M2.5 2.5v11 M5 5.5h8.5 M5 10.5h5.5" },
  alignCenter: { d: "M8 2.5v11 M3.5 5.5h9 M5.2 10.5h5.6" },
  alignRight: { d: "M13.5 2.5v11 M2.5 5.5H11 M5.5 10.5H11" },
  alignTop: { d: "M2.5 2.5h11 M5.5 5v8.5 M10.5 5v5.5" },
  alignMiddle: { d: "M2.5 8h11 M5.5 3.5v9 M10.5 5.2v5.6" },
  alignBottom: { d: "M2.5 13.5h11 M5.5 2.5V11 M10.5 5.5V11" },
  lineDown: { d: "M3 3l10 10" },
  lineUp: { d: "M3 13L13 3" },
  arrowLeft: { d: "M13 8H3 M7 4L3 8l4 4" },
  arrowRight: { d: "M3 8h10 M9 4l4 4-4 4" },
  arrowUp: { d: "M8 13V3 M4 7l4-4 4 4" },
  arrowDown: { d: "M8 3v10 M4 9l4 4 4-4" },
  chevron: { d: "M6 4l4 4-4 4" },
  enter: { d: "M4 2.5v5a2.5 2.5 0 0 0 2.5 2.5H12 M9 7l3 3-3 3" },
  /** Insert data: { } */
  braces: { d: "M6 2.5c-1.4 0-2 .6-2 1.8v1.9c0 1-.5 1.8-1.5 1.8 1 0 1.5.8 1.5 1.8v1.9c0 1.2.6 1.8 2 1.8 M10 2.5c1.4 0 2 .6 2 1.8v1.9c0 1 .5 1.8 1.5 1.8-1 0-1.5.8-1.5 1.8v1.9c0 1.2-.6 1.8-2 1.8" },
  /** Replace with a file: an arrow up out of a tray. */
  upload: { d: "M8 10V2.5 M5 5.5l3-3 3 3 M2.5 10.5v3h11v-3" },
  /** Native size: 1:1 in a frame. */
  actualSize: { d: "M2.5 2.5h11v11h-11z M5.3 6.2l1.2-1v5.6 M10.3 6.2l1.2-1v5.6 M8.5 7v.01 M8.5 9.5v.01" },
  /** Fit the box to its content: corners closing in on a line of text. */
  fitBox: { d: "M2.5 5.5v-3h3 M10.5 2.5h3v3 M13.5 10.5v3h-3 M5.5 13.5h-3v-3 M5.5 8h5" },
} satisfies Record<string, { d: string; fill?: boolean; width?: number }>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
  const icon: { d: string; fill?: boolean; width?: number } = ICONS[name];
  return <PathIcon d={icon.d} fill={icon.fill} width={icon.width} size={size} className={className} />;
}

/** Any 16×16 path data drawn like the built-in icons (elements define their own). */
export function PathIcon({ d, fill, width = 1.5, size = 14, className }: { d: string; fill?: boolean; width?: number; size?: number; className?: string }) {
  return (
    <svg className={`icon ${className ?? ""}`} viewBox="0 0 16 16" width={size} height={size} aria-hidden>
      <path d={d} fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
