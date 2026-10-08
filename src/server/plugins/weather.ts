import type { FetchPlugin } from "./types";
import { getJson } from "./types";

// WMO weather interpretation codes → [label, day icon, night icon]
const WMO: Record<number, [string, string, string]> = {
  0: ["Clear", "sun", "moon"],
  1: ["Mostly clear", "sun", "moon"],
  2: ["Partly cloudy", "cloud-sun", "cloud-moon"],
  3: ["Overcast", "overcast", "overcast"],
  45: ["Fog", "fog", "fog"],
  48: ["Rime fog", "fog", "fog"],
  51: ["Light drizzle", "drizzle", "drizzle"],
  53: ["Drizzle", "drizzle", "drizzle"],
  55: ["Heavy drizzle", "drizzle", "drizzle"],
  56: ["Freezing drizzle", "drizzle", "drizzle"],
  57: ["Freezing drizzle", "drizzle", "drizzle"],
  61: ["Light rain", "rain", "rain"],
  63: ["Rain", "rain", "rain"],
  65: ["Heavy rain", "rain", "rain"],
  66: ["Freezing rain", "rain", "rain"],
  67: ["Freezing rain", "rain", "rain"],
  71: ["Light snow", "snow", "snow"],
  73: ["Snow", "snow", "snow"],
  75: ["Heavy snow", "snow", "snow"],
  77: ["Snow grains", "snow", "snow"],
  80: ["Showers", "rain", "rain"],
  81: ["Showers", "rain", "rain"],
  82: ["Violent showers", "rain", "rain"],
  85: ["Snow showers", "snow", "snow"],
  86: ["Snow showers", "snow", "snow"],
  95: ["Thunderstorm", "thunder", "thunder"],
  96: ["Thunder + hail", "thunder", "thunder"],
  99: ["Thunder + hail", "thunder", "thunder"],
};

const describe = (code: number, day = true) => {
  const [label, d, n] = WMO[code] ?? ["Unknown", "cloud", "cloud"];
  return { condition: label, icon: day ? d : n };
};

/**
 * Simple flags for effects and conditions: {{weather.isRaining}} etc., and
 * {{weather.effect}} ("rain", "snow", "stars", "clouds", "overcast" or "none")
 * for an Effect element to follow. Drizzle and thunderstorms count as rain, and fog as overcast.
 */
export function atmosphere(code: number, isDay: boolean) {
  const isSnowing = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const isRaining = !isSnowing && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);
  const isClearNight = !isDay && code <= 1;
  const effect = isSnowing ? "snow" : isRaining ? "rain" : isClearNight ? "stars" : code === 2 ? "clouds" : code === 3 || code === 45 || code === 48 ? "overcast" : "none";
  return { isRaining, isSnowing, isClearNight, effect };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const geoCache = new Map<string, { lat: number; lon: number; name: string }>();

async function geocode(q: string, signal: AbortSignal) {
  const hit = geoCache.get(q);
  if (hit) return hit;
  const r = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(q)}`, signal);
  const g = r.results?.[0];
  if (!g) throw new Error(`Couldn't find a place called "${q}"`);
  const out = { lat: g.latitude, lon: g.longitude, name: g.name };
  geoCache.set(q, out);
  return out;
}

export const weatherPlugin: FetchPlugin = {
  info: {
    id: "weather",
    name: "Weather",
    description: "Current conditions and a 3-day forecast from Open-Meteo. Free, no API key.",
    live: false,
    defaultAlias: "weather",
    defaultRefreshSec: 900,
    fields: [
      { key: "location", label: "Place", type: "string", placeholder: "Kyiv", help: "City name, or leave blank and use latitude/longitude." },
      { key: "lat", label: "Latitude", type: "number", step: 0.0001 },
      { key: "lon", label: "Longitude", type: "number", step: 0.0001 },
      { key: "units", label: "Units", type: "select", options: [{ value: "celsius", label: "°C, km/h" }, { value: "fahrenheit", label: "°F, mph" }] },
    ],
    defaultConfig: { location: "", lat: null, lon: null, units: "celsius" },
    sample: {
      location: "Kyiv",
      temp: 18,
      feelsLike: 17,
      high: 21,
      low: 11,
      humidity: 62,
      wind: 14,
      windDir: "NW",
      precipChance: 20,
      condition: "Partly cloudy",
      icon: "cloud-sun",
      isDay: true,
      isRaining: false,
      isSnowing: false,
      isClearNight: false,
      effect: "clouds",
      unit: "°",
      forecast: [
        { day: "Mon", high: 20, low: 10, condition: "Rain", icon: "rain" },
        { day: "Tue", high: 22, low: 12, condition: "Clear", icon: "sun" },
        { day: "Wed", high: 19, low: 9, condition: "Overcast", icon: "overcast" },
      ],
    },
  },
  async fetch(config, signal) {
    let lat = Number(config.lat);
    let lon = Number(config.lon);
    let name = String(config.location || "");
    if (name && (!config.lat || !config.lon)) {
      const g = await geocode(name, signal);
      lat = g.lat;
      lon = g.lon;
      name = g.name;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (config.lat == null && !config.location)) throw new Error("Set a place or latitude/longitude");
    const imperial = config.units === "fahrenheit";
    const q = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "auto",
      forecast_days: "4",
      temperature_unit: imperial ? "fahrenheit" : "celsius",
      wind_speed_unit: imperial ? "mph" : "kmh",
    });
    const r = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`, signal);
    const c = r.current;
    const d = r.daily;
    const isDay = c.is_day === 1;
    const days = (d.time as string[]).map((iso, i) => ({
      day: new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      high: Math.round(d.temperature_2m_max[i]),
      low: Math.round(d.temperature_2m_min[i]),
      precipChance: d.precipitation_probability_max?.[i] ?? null,
      ...describe(d.weather_code[i]),
    }));
    return {
      location: name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      high: days[0]?.high,
      low: days[0]?.low,
      humidity: Math.round(c.relative_humidity_2m),
      wind: Math.round(c.wind_speed_10m),
      windDir: COMPASS[Math.round(c.wind_direction_10m / 45) % 8],
      precipChance: days[0]?.precipChance,
      ...describe(c.weather_code, isDay),
      isDay,
      ...atmosphere(c.weather_code, isDay),
      unit: "°",
      forecast: days.slice(1),
    };
  },
};
