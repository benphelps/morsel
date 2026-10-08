import { EventEmitter } from "node:events";
import { LIVE_PLUGINS } from "../shared/live";
import type { SourceInstance, SourceStatus } from "../shared/types";
import { FETCH_PLUGINS } from "./plugins";

interface Entry {
  source: SourceInstance;
  key: string;
  data: unknown;
  updatedAt: number | null;
  error: string | null;
  timer: NodeJS.Timeout | null;
  inflight: AbortController | null;
}

const MIN_REFRESH_SEC = 30;

/** Keeps every fetched source's latest value warm on its own timer. Emits "update" after each fetch. */
export class DataManager extends EventEmitter {
  private entries = new Map<string, Entry>();

  sync(sources: SourceInstance[]) {
    const seen = new Set<string>();
    for (const s of sources) {
      if (LIVE_PLUGINS[s.plugin]) continue;
      seen.add(s.id);
      const key = JSON.stringify([s.plugin, s.config, s.refreshSec]);
      const existing = this.entries.get(s.id);
      if (existing && existing.key === key) {
        existing.source = s;
        continue;
      }
      if (existing) this.stop(existing);
      const e: Entry = { source: s, key, data: existing?.data ?? null, updatedAt: existing?.updatedAt ?? null, error: null, timer: null, inflight: null };
      this.entries.set(s.id, e);
      // Pushed sources wait for data to arrive instead of fetching.
      if (!FETCH_PLUGINS[s.plugin]?.info.push) void this.refresh(s.id);
    }
    for (const [id, e] of this.entries) if (!seen.has(id)) (this.stop(e), this.entries.delete(id));
  }

  private stop(e: Entry) {
    if (e.timer) clearTimeout(e.timer);
    e.inflight?.abort();
  }

  /** Stores data another app sent for a push source. */
  push(id: string, data: unknown) {
    const e = this.entries.get(id);
    if (!e) return;
    e.data = data;
    e.updatedAt = Date.now();
    e.error = null;
    this.emit("update", id);
  }

  async refresh(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e || FETCH_PLUGINS[e.source.plugin]?.info.push) return;
    const plugin = FETCH_PLUGINS[e.source.plugin];
    if (e.timer) clearTimeout(e.timer);
    e.inflight?.abort();
    const ctl = new AbortController();
    e.inflight = ctl;
    const timeout = setTimeout(() => ctl.abort(), 15000);
    try {
      if (!plugin) throw new Error(`Unknown plugin "${e.source.plugin}"`);
      e.data = await plugin.fetch(e.source.config as Record<string, any>, ctl.signal);
      e.updatedAt = Date.now();
      e.error = null;
    } catch (err: any) {
      if (ctl.signal.aborted && e.inflight !== ctl) return; // superseded
      e.error = err?.name === "AbortError" ? "Timed out" : String(err?.message ?? err);
    } finally {
      clearTimeout(timeout);
      if (e.inflight === ctl) e.inflight = null;
    }
    // Back off to a minute after errors so a typo doesn't hammer an API.
    const next = Math.max(MIN_REFRESH_SEC, e.error ? 60 : e.source.refreshSec || 300);
    e.timer = setTimeout(() => void this.refresh(id), next * 1000);
    this.emit("update", id);
  }

  /** Latest data keyed by source id. */
  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [id, e] of this.entries) out[id] = e.data;
    return out;
  }

  status(): SourceStatus[] {
    return [...this.entries.values()].map((e) => ({ id: e.source.id, data: e.data, updatedAt: e.updatedAt, error: e.error }));
  }
}
