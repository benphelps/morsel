import { XMLParser } from "fast-xml-parser";
import sharp from "sharp";
import { tunedPixels } from "../ledtune";
import type { FetchPlugin } from "./types";

// Google News search as a source: a query's headlines with the source split
// out of the title, and each source's favicon, sized for the panel.
//
// Links are Google's own redirect links (news.google.com/rss/articles/…);
// resolving them to the publisher's URL needs an extra lookup per story, left
// for when there's something to show them with (e.g. a QR code).

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") return text((v as Record<string, unknown>)["#text"] ?? "");
  return String(v)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
};

/** A bitmap for the image element (and a rotator's item image): {srcW, srcH, data} with base64 RGBA. */
export interface Bitmap {
  srcW: number;
  srcH: number;
  data: string;
}

/** "Headline - Reuters" → "Headline", when the tail is the story's source. */
export function cleanTitle(title: string, source: string): string {
  if (!source) return title;
  const tail = new RegExp(`\\s+[-–—|]\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const cleaned = title.replace(tail, "").trim();
  return cleaned || title;
}

/** "45m ago", "3h ago", "2d ago". */
export function ago(date: Date, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - date.getTime()) / 60000));
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

/** Editions: country:language, as Google's ceid. */
const EDITIONS: { value: string; label: string }[] = [
  { value: "US:en", label: "United States (English)" },
  { value: "GB:en", label: "United Kingdom (English)" },
  { value: "CA:en", label: "Canada (English)" },
  { value: "AU:en", label: "Australia (English)" },
  { value: "IN:en", label: "India (English)" },
  { value: "UA:uk", label: "Україна (Українська)" },
  { value: "DE:de", label: "Deutschland (Deutsch)" },
  { value: "FR:fr", label: "France (Français)" },
];

export function feedUrl(config: Record<string, unknown>): string {
  const query = String(config.query ?? "").trim();
  const when = String(config.when ?? "");
  const [country, lang] = String(config.edition || "US:en").split(":");
  const edition = { hl: lang === "en" ? `en-${country}` : lang, gl: country, ceid: `${country}:${lang}` };
  // No search: the edition's top stories.
  if (!query) return `https://news.google.com/rss?${new URLSearchParams(edition)}`;
  const q = when ? `${query} when:${when}` : query;
  return `https://news.google.com/rss/search?${new URLSearchParams({ q, ...edition })}`;
}

/* ---------------- favicons ---------------- */

const favicons = new Map<string, { at: number; icons: Promise<{ favicon: Bitmap; favicon8: Bitmap } | null> }>();
const FAVICON_TTL = 24 * 3600_000;

/** The favicon at size×size, tuned for LEDs like album art (dark logos like Reuters' come out dim otherwise). */
async function toBitmap(png: Buffer, size: number): Promise<Bitmap> {
  const raw = await tunedPixels(sharp(png), size, size, "contain");
  return { srcW: size, srcH: size, data: raw.toString("base64") };
}

/** A site's favicon at 16×16 and 8×8 (each resized from the original, which looks better than scaling on the panel). */
function faviconFor(domain: string): Promise<{ favicon: Bitmap; favicon8: Bitmap } | null> {
  const hit = favicons.get(domain);
  if (hit && Date.now() - hit.at < FAVICON_TTL) return hit.icons;
  const icons = (async () => {
    try {
      const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null; // 404: Google doesn't know the site
      const png = Buffer.from(await res.arrayBuffer());
      return { favicon: await toBitmap(png, 16), favicon8: await toBitmap(png, 8) };
    } catch {
      return null;
    }
  })();
  favicons.set(domain, { at: Date.now(), icons });
  return icons;
}

/* ---------------- sample ---------------- */

/** A stand-in favicon: a coloured rounded square, for the editor before the first fetch. */
function sampleIcon(size: number, rgb: [number, number, number]): Bitmap {
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const corner = (x === 0 || x === size - 1) && (y === 0 || y === size - 1);
      px.set(corner ? [0, 0, 0, 0] : [...rgb, 255], (y * size + x) * 4);
    }
  return { srcW: size, srcH: size, data: Buffer.from(px).toString("base64") };
}

const sampleItem = (title: string, source: string, domain: string, published: string, rgb: [number, number, number]) => ({
  title,
  source,
  domain,
  published,
  favicon: sampleIcon(16, rgb),
  favicon8: sampleIcon(8, rgb),
  link: "https://news.google.com/",
});

export const googleNewsPlugin: FetchPlugin = {
  info: {
    id: "googlenews",
    name: "Google News",
    description: "Headlines for any search, with each story's source and its favicon. Free, no key.",
    live: false,
    defaultAlias: "gnews",
    defaultRefreshSec: 900,
    fields: [
      { key: "query", label: "Search", type: "string", placeholder: "Top stories", help: 'Anything Google News understands: words, "exact phrases", site:bbc.co.uk, -left_out. Leave blank for top stories.' },
      {
        key: "when",
        label: "From the last",
        type: "select",
        options: [
          { value: "1h", label: "Hour" },
          { value: "12h", label: "12 hours" },
          { value: "1d", label: "Day" },
          { value: "7d", label: "Week" },
          { value: "", label: "Any time" },
        ],
      },
      { key: "edition", label: "Edition", type: "select", options: EDITIONS },
      { key: "max", label: "Stories to keep", type: "number", min: 1, max: 30 },
    ],
    defaultConfig: { query: "", when: "1d", edition: "US:en", max: 8 },
    sample: (() => {
      const items = [
        sampleItem("Scientists map the deep ocean floor in record detail", "Reuters", "reuters.com", "2h ago", [255, 128, 0]),
        sampleItem("City opens its first car-free district", "The Guardian", "theguardian.com", "4h ago", [5, 41, 98]),
        sampleItem("New telescope captures a distant galaxy", "BBC", "bbc.co.uk", "6h ago", [187, 25, 25]),
      ];
      return {
        query: "",
        feed: "Google News: Top stories",
        count: items.length,
        headline: items[0].title,
        source: items[0].source,
        favicon: items[0].favicon,
        ticker: items.map((i) => i.title).join(" • "),
        items,
      };
    })(),
  },
  async fetch(config, signal) {
    const query = String(config.query ?? "").trim();
    const res = await fetch(feedUrl(config), { signal, headers: { "user-agent": "morsel/0.1" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from Google News`);
    const channel = parser.parse(await res.text()).rss?.channel;
    if (!channel) throw new Error("Google News sent something that isn't a feed");
    const raw = channel.item ?? [];
    const list = (Array.isArray(raw) ? raw : [raw]).slice(0, Math.max(1, Number(config.max) || 8));

    const items = await Promise.all(
      list.map(async (it: Record<string, unknown>) => {
        const src = it.source as Record<string, unknown> | string | undefined;
        const source = text(src);
        const url = typeof src === "object" ? String(src["@url"] ?? "") : "";
        let domain = "";
        try {
          domain = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          /* no source link */
        }
        const icons = domain ? await faviconFor(domain) : null;
        const published = new Date(text(it.pubDate));
        return {
          title: cleanTitle(text(it.title), source),
          source,
          domain,
          published: Number.isNaN(published.getTime()) ? "" : ago(published),
          favicon: icons?.favicon ?? null,
          favicon8: icons?.favicon8 ?? null,
          link: text(it.link),
        };
      }),
    );
    return {
      query,
      feed: `Google News: ${query || "Top stories"}`,
      count: items.length,
      headline: items[0]?.title ?? "",
      source: items[0]?.source ?? "",
      favicon: items[0]?.favicon ?? null,
      ticker: items.map((i) => i.title).join(" • "),
      items,
    };
  },
};
