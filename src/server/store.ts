import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { createProject } from "../shared/defaults";
import { ensureSystemSlides } from "../shared/templates";
import type { Project } from "../shared/types";

export const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");

/** Holds the single project document and persists it as JSON. */
export class Store extends EventEmitter {
  private file = join(DATA_DIR, "project.json");
  project: Project;
  /**
   * Changes on every save, so an editor can tell whether the project moved on
   * since it last loaded it. Prefixed per server start, so a revision from
   * before a restart never matches by accident.
   */
  revision = `${randomBytes(3).toString("hex")}-1`;
  private saves = 1;

  constructor() {
    super();
    mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(this.file)) {
      this.project = JSON.parse(readFileSync(this.file, "utf8")) as Project;
      if (ensureSystemSlides(this.project)) this.persist();
    } else {
      this.project = createProject(process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      ensureSystemSlides(this.project);
      this.persist();
    }
  }

  /** `origin` identifies the editor tab that saved, so it can ignore its own echo. */
  save(next: Project, origin = "") {
    ensureSystemSlides(next);
    this.project = next;
    this.revision = `${this.revision.split("-")[0]}-${++this.saves}`;
    this.persist();
    this.emit("change", next, origin);
  }

  private persist() {
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.project, null, 1));
    renameSync(tmp, this.file);
  }
}
