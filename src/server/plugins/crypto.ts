import type { FetchPlugin } from "./types";
import { getJson } from "./types";

export const cryptoPlugin: FetchPlugin = {
  info: {
    id: "crypto",
    name: "Crypto prices",
    description: "Spot prices and 24h change from CoinGecko. Free, no API key.",
    live: false,
    defaultAlias: "crypto",
    defaultRefreshSec: 300,
    fields: [
      { key: "coins", label: "Coin IDs", type: "string", placeholder: "bitcoin,ethereum", help: "CoinGecko IDs, comma separated." },
      { key: "currency", label: "Currency", type: "string", placeholder: "usd" },
    ],
    defaultConfig: { coins: "bitcoin,ethereum", currency: "usd" },
    sample: {
      bitcoin: { price: 64250, change: 2.4, trend: "trend-up" },
      ethereum: { price: 3120.5, change: -1.2, trend: "trend-down" },
    },
  },
  async fetch(config, signal) {
    const ids = String(config.coins || "bitcoin").replace(/\s/g, "");
    const cur = String(config.currency || "usd").toLowerCase();
    const r = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${cur}&include_24hr_change=true`, signal);
    const out: Record<string, unknown> = {};
    for (const [id, v] of Object.entries<any>(r)) {
      const change = Math.round((v[`${cur}_24h_change`] ?? 0) * 10) / 10;
      out[id] = { price: v[cur], change, trend: change >= 0 ? "trend-up" : "trend-down" };
    }
    return out;
  },
};
