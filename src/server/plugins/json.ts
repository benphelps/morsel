import { lookup } from "../../shared/bindings";
import type { FetchPlugin } from "./types";
import { getJson } from "./types";

export const jsonPlugin: FetchPlugin = {
  info: {
    id: "json",
    name: "Any JSON API",
    description: "Fetches a JSON URL. Bind to any field in the response, e.g. {{api.data.price}}.",
    live: false,
    defaultAlias: "api",
    defaultRefreshSec: 300,
    fields: [
      { key: "url", label: "URL", type: "string", placeholder: "https://api.example.com/thing.json" },
      { key: "headers", label: "Headers (JSON)", type: "string", placeholder: '{"Authorization": "Bearer …"}', secret: true },
      { key: "root", label: "Only keep this path", type: "string", placeholder: "data.items.0", help: "Optional. Narrows the response before binding." },
    ],
    defaultConfig: { url: "", headers: "", root: "" },
    sample: { example: "Fetch once to see the real fields" },
  },
  async fetch(config, signal) {
    if (!config.url) throw new Error("Set a URL");
    let headers: Record<string, string> = {};
    if (config.headers) {
      try {
        headers = JSON.parse(String(config.headers));
      } catch {
        throw new Error("Headers must be valid JSON");
      }
    }
    const data = await getJson(String(config.url), signal, headers);
    return config.root ? lookup(data, String(config.root)) : data;
  },
};
