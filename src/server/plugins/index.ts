import { LIVE_PLUGINS } from "../../shared/live";
import type { PluginInfo } from "../../shared/types";
import { macCalendarPlugin } from "./calendar";
import { cryptoPlugin } from "./crypto";
import { googleNewsPlugin } from "./googlenews";
import { homeAssistantPlugin } from "./homeassistant";
import { jsonPlugin } from "./json";
import { rssPlugin } from "./rss";
import { stocksPlugin } from "./stocks";
import type { FetchPlugin } from "./types";
import { weatherPlugin } from "./weather";

// To add a data source: write a FetchPlugin and list it here.
export const FETCH_PLUGINS: Record<string, FetchPlugin> = Object.fromEntries(
  [weatherPlugin, rssPlugin, googleNewsPlugin, stocksPlugin, macCalendarPlugin, cryptoPlugin, homeAssistantPlugin, jsonPlugin].map((p) => [p.info.id, p]),
);

export function allPluginInfo(): PluginInfo[] {
  return [...Object.values(LIVE_PLUGINS).map((p) => p.info), ...Object.values(FETCH_PLUGINS).map((p) => p.info)];
}
