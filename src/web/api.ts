import type { DeviceStatus, DndState, PluginInfo, Project, SourceStatus } from "../shared/types";

/** Identifies this tab, so it can tell its own saves from other editors'. */
export const CLIENT_ID = Math.random().toString(36).slice(2);

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json", "x-morsel-client": CLIENT_ID } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export type SaveResult = { ok: true; revision: string } | { ok: false; conflict: { project: Project; revision: string } };

export const api = {
  /** The project and its revision (which changes on every save). */
  async project(): Promise<{ project: Project; revision: string }> {
    const res = await fetch("/api/project");
    if (!res.ok) throw new Error(`GET /api/project: ${res.status}`);
    return { project: (await res.json()) as Project, revision: res.headers.get("x-morsel-revision") ?? "" };
  },
  /** Saves over revision `base`; if something else saved since, returns what's there now instead. */
  async saveProject(p: Project, base: string): Promise<SaveResult> {
    const res = await fetch("/api/project", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-morsel-client": CLIENT_ID, "x-morsel-base": base },
      body: JSON.stringify(p),
    });
    if (res.status === 409) return { ok: false, conflict: (await res.json()) as { project: Project; revision: string } };
    if (!res.ok) throw new Error(`PUT /api/project: ${res.status}`);
    return { ok: true, revision: ((await res.json()) as { revision: string }).revision };
  },
  plugins: () => req<PluginInfo[]>("GET", "/api/plugins"),
  sourceStatus: () => req<SourceStatus[]>("GET", "/api/sources/status"),
  refreshSource: (id: string) => req<SourceStatus | null>("POST", `/api/sources/${id}/refresh`),
  testSource: (plugin: string, config: Record<string, unknown>) =>
    req<{ ok: boolean; data?: unknown; error?: string }>("POST", "/api/sources/test", { plugin, config }),
  device: () => req<DeviceStatus & { brightnessNow: number; hosts: string[]; now: number }>("GET", "/api/device"),
  showOnDevice: (slideId: string) => req<{ ok: boolean }>("POST", "/api/device/show", { slideId }),
  dnd: () => req<DndState>("GET", "/api/dnd"),
  setDnd: (patch: Partial<DndState> & { minutes?: number }) => req<DndState>("POST", "/api/dnd", patch),
  sampleNotify: (kind: string) => req<{ ok: boolean }>("POST", "/api/notify/sample", { kind }),
  notify: (body: { text: string; icon?: string; color?: string; durationSec?: number }) => req<{ ok: boolean }>("POST", "/api/notify", body),
  async renderInfo(slideId: string) {
    const res = await fetch(`/api/render/${slideId}`);
    if (!res.ok) return null;
    return { frames: Number(res.headers.get("x-frames")), bytes: Number(res.headers.get("x-bytes")), dwell: Number(res.headers.get("x-dwell")), max: Number(res.headers.get("x-max-bytes")) };
  },
};
