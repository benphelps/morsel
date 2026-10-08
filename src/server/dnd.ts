import { EventEmitter } from "node:events";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DndState } from "../shared/types";
import { DATA_DIR } from "./store";

export const DND_OFF: DndState = { enabled: false, until: null, slideId: null, brightness: null, muteNotifications: true };

/**
 * Do Not Disturb state. Kept in its own file, not the project, so an editor
 * saving the project can never switch it on or off by accident.
 * Emits "change" with the new state; switches itself off at `until`.
 */
export class DndStore extends EventEmitter {
  private file = join(DATA_DIR, "dnd.json");
  state: DndState;

  constructor() {
    super();
    this.state = existsSync(this.file) ? { ...DND_OFF, ...JSON.parse(readFileSync(this.file, "utf8")) } : { ...DND_OFF };
    setInterval(() => this.expire(), 10_000);
    this.expire();
  }

  update(patch: Partial<DndState>) {
    const prev = this.state;
    const next = { ...this.state, ...patch };
    if (!next.enabled) next.until = null;
    this.state = next;
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(next, null, 1));
    renameSync(tmp, this.file);
    this.emit("change", next, prev);
  }

  private expire() {
    if (this.state.enabled && this.state.until && Date.now() >= this.state.until) this.update({ enabled: false });
  }
}
