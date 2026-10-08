import type { FetchPlugin } from "./types";
import { getJson } from "./types";

export const homeAssistantPlugin: FetchPlugin = {
  info: {
    id: "homeassistant",
    name: "Home Assistant",
    description: "Entity states from Home Assistant, e.g. {{home.sensor_outdoor_temp.state}}.",
    live: false,
    defaultAlias: "home",
    defaultRefreshSec: 60,
    fields: [
      { key: "url", label: "Home Assistant URL", type: "string", placeholder: "http://homeassistant.local:8123" },
      { key: "token", label: "Long-lived access token", type: "string", secret: true },
      { key: "entities", label: "Entity IDs", type: "string", placeholder: "sensor.outdoor_temp, light.kitchen", help: "Comma separated. Dots become underscores in bindings." },
    ],
    defaultConfig: { url: "", token: "", entities: "" },
    sample: { sensor_outdoor_temp: { state: "18.5", unit: "°C", name: "Outdoor temperature" } },
  },
  async fetch(config, signal) {
    if (!config.url || !config.token) throw new Error("Set the URL and token");
    const base = String(config.url).replace(/\/$/, "");
    const ids = String(config.entities || "").split(",").map((s) => s.trim()).filter(Boolean);
    const out: Record<string, unknown> = {};
    await Promise.all(
      ids.map(async (id) => {
        const e = await getJson(`${base}/api/states/${id}`, signal, { authorization: `Bearer ${config.token}` });
        out[id.replace(/\./g, "_")] = { state: e.state, unit: e.attributes?.unit_of_measurement ?? "", name: e.attributes?.friendly_name ?? id, attributes: e.attributes };
      }),
    );
    return out;
  },
};
