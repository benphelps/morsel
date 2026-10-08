import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { shapeQuote, stocksPlugin } from "./stocks";

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

function mockFetch(handler: (url: string) => { status: number; body: unknown }) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    const r = handler(url);
    return new Response(JSON.stringify(r.body), { status: r.status, statusText: r.status === 200 ? "OK" : "Not Found" });
  }) as any;
  return calls;
}

const chart = (price: number, name: string) => ({
  chart: {
    result: [
      {
        meta: { regularMarketPrice: price, previousClose: 100, regularMarketDayHigh: price + 1, regularMarketDayLow: 99, regularMarketTime: 1790627771, shortName: name, currency: "USD", fullExchangeName: "NasdaqGS" },
        indicators: { quote: [{ open: [null, 100.5], close: [100.5, null, price] }] },
      },
    ],
  },
});

test("shapes a quote with signed text and trend icons", () => {
  const q = shapeQuote("MSFT", { price: 509.22, open: 515, high: 517, low: 507, prevClose: 516.17, time: 0 });
  assert.equal(q.changeText, "-6.95");
  assert.equal(q.changePctText, "-1.35%");
  assert.equal(q.trend, "trend-down");
  assert.equal(q.priceText, "509.22");
});

test("every ticker comes from Yahoo, no key, with the day's prices for sparklines", async () => {
  const calls = mockFetch((url) => ({ status: 200, body: chart(url.includes("GSPC") ? 101.5 : 98, url.includes("GSPC") ? "S&P 500" : "Apple") }));
  const data: any = await stocksPlugin.fetch({ symbols: "aapl, ^GSPC, brk.b, btc-usd" }, new AbortController().signal);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((u) => u.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/")));
  assert.equal(data.AAPL.price, 98);
  assert.equal(data.AAPL.changePctText, "-2.00%");
  assert.deepEqual(data.GSPC.series, [100.5, 101.5]); // gaps dropped
  assert.equal(data.GSPC.open, 100.5);
  assert.equal(data.BRK_B.symbol, "BRK.B");
  assert.equal(data.BTC_USD.symbol, "BTC-USD");
  assert.equal(data.list.length, 4);
});

test("an unknown ticker is marked, without failing the rest", async () => {
  mockFetch((url) => (url.includes("NOPE") ? { status: 404, body: { chart: { result: null } } } : { status: 200, body: chart(98, "Apple") }));
  const data: any = await stocksPlugin.fetch({ symbols: "AAPL, NOPE" }, new AbortController().signal);
  assert.equal(data.NOPE.error, "Unknown ticker");
  assert.equal(data.AAPL.price, 98);
});
