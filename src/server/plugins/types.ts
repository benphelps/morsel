import type { PluginInfo } from "../../shared/types";

export interface FetchPlugin {
  info: PluginInfo;
  fetch(config: Record<string, any>, signal: AbortSignal): Promise<unknown>;
}

export async function getJson(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { signal, headers: { "user-agent": "morsel/0.1", ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json();
}
