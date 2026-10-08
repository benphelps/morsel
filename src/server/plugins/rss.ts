import { XMLParser } from "fast-xml-parser";
import type { FetchPlugin } from "./types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") return text((v as any)["#text"] ?? "");
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

export const rssPlugin: FetchPlugin = {
  info: {
    id: "rss",
    name: "News / RSS",
    description: "Headlines from any RSS or Atom feed.",
    live: false,
    defaultAlias: "news",
    defaultRefreshSec: 600,
    fields: [
      { key: "url", label: "Feed URL", type: "string", placeholder: "https://feeds.bbci.co.uk/news/rss.xml" },
      { key: "max", label: "Headlines to keep", type: "number", min: 1, max: 30 },
      { key: "separator", label: "Ticker separator", type: "string", placeholder: " • " },
    ],
    defaultConfig: { url: "https://feeds.bbci.co.uk/news/rss.xml", max: 8, separator: " • " },
    sample: {
      feed: "BBC News",
      headline: "Scientists teach an LED sign to read the news",
      ticker: "Scientists teach an LED sign to read the news • Local cat elected mayor • Markets flat",
      count: 3,
      items: [
        { title: "Scientists teach an LED sign to read the news", link: "https://example.com/1" },
        { title: "Local cat elected mayor", link: "https://example.com/2" },
        { title: "Markets flat", link: "https://example.com/3" },
      ],
    },
  },
  async fetch(config, signal) {
    if (!config.url) throw new Error("Set a feed URL");
    const res = await fetch(String(config.url), { signal, headers: { "user-agent": "morsel/0.1" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const doc = parser.parse(await res.text());
    const channel = doc.rss?.channel ?? doc.feed ?? doc["rdf:RDF"];
    if (!channel) throw new Error("That doesn't look like an RSS or Atom feed");
    const raw = channel.item ?? channel.entry ?? doc["rdf:RDF"]?.item ?? [];
    const list = (Array.isArray(raw) ? raw : [raw]).slice(0, Number(config.max) || 8);
    const items = list.map((it: any) => ({
      title: text(it.title),
      link: typeof it.link === "object" ? it.link?.["@href"] ?? "" : text(it.link),
      date: text(it.pubDate ?? it.updated ?? it.published ?? ""),
    }));
    return {
      feed: text(channel.title),
      headline: items[0]?.title ?? "",
      ticker: items.map((i: any) => i.title).join(String(config.separator ?? " • ")),
      count: items.length,
      items,
    };
  },
};
