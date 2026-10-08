import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./store";

/**
 * How many times each slide has been on the display, kept across restarts:
 * a rotator that shows a few items each time uses it to carry on where the
 * last showing left off (passed to rendering as `$play`).
 */
export class PlayCounter {
  private file = join(DATA_DIR, "plays.json");
  private counts: Record<string, number> = {};

  constructor() {
    try {
      if (existsSync(this.file)) this.counts = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      this.counts = {}; // unreadable: start counting again
    }
  }

  /** How many times the slide has been shown so far: the number of its next showing. */
  get(slideId: string): number {
    return this.counts[slideId] ?? 0;
  }

  /** The slide has just gone on the display. */
  shown(slideId: string) {
    this.counts[slideId] = this.get(slideId) + 1;
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.counts));
    renameSync(tmp, this.file);
  }
}
