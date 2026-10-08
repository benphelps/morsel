import type { FetchPlugin } from "./types";
import { getJson } from "./types";

// Quotes from Yahoo Finance's chart endpoint: stocks, ETFs, indices (^GSPC)
// and crypto pairs (BTC-USD), with the day's prices for sparklines. No key.
// Real-time for NYSE, Nasdaq and the S&P, Dow and Nasdaq indices; Cboe indices
// (^VIX) and OTC stocks run 15 minutes behind. The endpoint is unofficial:
// fine for a personal display, but it can change without notice.

/** Binding-safe key for a ticker: "BRK.B" → "BRK_B", "^GSPC" → "GSPC", "BTC-USD" → "BTC_USD". */
export const keyFor = (symbol: string) => symbol.replace(/^\^/, "").replace(/[^A-Za-z0-9]/g, "_");

// Plain ASCII signs: the bundled pixel fonts have no typographic minus.
const signed = (n: number, digits: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(digits)}`;

interface Quote {
  price: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  /** Unix seconds of the last trade. */
  time: number;
}

export function shapeQuote(symbol: string, q: Quote, extra: { name?: string; series?: number[]; currency?: string; exchange?: string } = {}) {
  const change = q.price - q.prevClose;
  const changePct = q.prevClose ? (change / q.prevClose) * 100 : 0;
  const up = change >= 0;
  return {
    symbol,
    name: extra.name ?? symbol,
    price: q.price,
    change: Math.round(change * 100) / 100,
    changePct: Math.round(changePct * 100) / 100,
    open: q.open,
    high: q.high,
    low: q.low,
    prevClose: q.prevClose,
    up,
    trend: up ? "trend-up" : "trend-down",
    arrow: up ? "arrow-up" : "arrow-down",
    priceText: q.price.toFixed(2),
    changeText: signed(change, 2),
    changePctText: `${signed(changePct, 2)}%`,
    currency: extra.currency ?? "",
    exchange: extra.exchange ?? "",
    updated: q.time ? new Date(q.time * 1000).toISOString() : null,
    /** The day's prices at 5-minute steps, for sparklines. */
    series: extra.series ?? [],
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

async function yahooQuote(symbol: string, signal: AbortSignal) {
  let r;
  try {
    r = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`, signal);
  } catch (err: any) {
    if (/\b404\b/.test(String(err?.message))) return { symbol, error: "Unknown ticker" };
    if (/\b429\b/.test(String(err?.message))) throw new Error("Yahoo is rate-limiting; refresh less often");
    return { symbol, error: String(err?.message ?? err) };
  }
  const res = r?.chart?.result?.[0];
  const m = res?.meta;
  if (!m?.regularMarketPrice) return { symbol, error: "Yahoo has no price for this ticker" };
  const q = res.indicators?.quote?.[0] ?? {};
  const series: number[] = (q.close ?? []).filter((x: number | null) => x != null).map(round2);
  const firstOpen = (q.open ?? []).find((x: number | null) => x != null);
  const prevClose = m.previousClose ?? m.chartPreviousClose ?? m.regularMarketPrice;
  return shapeQuote(
    symbol,
    { price: m.regularMarketPrice, open: firstOpen ?? prevClose, high: m.regularMarketDayHigh ?? m.regularMarketPrice, low: m.regularMarketDayLow ?? m.regularMarketPrice, prevClose, time: m.regularMarketTime },
    { name: m.shortName ?? m.longName ?? symbol, series, currency: m.currency, exchange: m.fullExchangeName ?? m.exchangeName },
  );
}

const SAMPLE_QUOTES = [
  shapeQuote("AAPL", { price: 338.4, open: 336.0, high: 340.1, low: 335.2, prevClose: 337.18, time: 1790600000 }, { name: "Apple Inc.", currency: "USD", exchange: "NasdaqGS", series: [336.0, 337.4, 336.8, 338.4] }),
  shapeQuote("MSFT", { price: 509.22, open: 515.0, high: 517.3, low: 507.9, prevClose: 516.17, time: 1790600000 }, { name: "Microsoft Corporation", currency: "USD", exchange: "NasdaqGS", series: [515.0, 512.6, 510.1, 509.22] }),
  shapeQuote("^GSPC", { price: 7683.69, open: 7721.7, high: 7724.15, low: 7666.6, prevClose: 7743.41, time: 1790627771 }, { name: "S&P 500", currency: "USD", exchange: "SNP", series: [7721.7, 7705.2, 7690.4, 7683.69] }),
];

export const stocksPlugin: FetchPlugin = {
  info: {
    id: "stocks",
    name: "Stocks",
    description:
      "Stocks, ETFs, indices and crypto pairs from Yahoo Finance: price, the day's change and its prices for sparklines. No key. Real-time for NYSE, Nasdaq and the main US indices; ^VIX and OTC stocks run 15 minutes behind.",
    live: false,
    defaultAlias: "stocks",
    defaultRefreshSec: 60,
    fields: [
      {
        key: "symbols",
        label: "Tickers",
        type: "string",
        placeholder: "AAPL, MSFT, ^GSPC, BTC-USD",
        help: "Comma separated, as Yahoo Finance writes them. Bind with {{stocks.AAPL.price}}; indices drop the ^ ({{stocks.GSPC.price}}), and dots and dashes become underscores (BRK.B → BRK_B).",
      },
    ],
    defaultConfig: { symbols: "AAPL, MSFT, ^GSPC" },
    sample: { AAPL: SAMPLE_QUOTES[0], MSFT: SAMPLE_QUOTES[1], GSPC: SAMPLE_QUOTES[2], list: SAMPLE_QUOTES },
  },
  async fetch(config, signal) {
    const symbols = String(config.symbols ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (!symbols.length) throw new Error("Add at least one ticker");
    if (symbols.length > 30) throw new Error("Up to 30 tickers");
    const quotes = await Promise.all(symbols.map((s) => yahooQuote(s, signal)));
    const out: Record<string, unknown> = Object.fromEntries(quotes.map((q) => [keyFor(q.symbol), q]));
    out.list = quotes;
    return out;
  },
};
