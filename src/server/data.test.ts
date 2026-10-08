import assert from "node:assert/strict";
import { test } from "node:test";
import { conditionHolds } from "../shared/bindings";
import { buildScope } from "../shared/live";
import { DataManager } from "./data";

test("push sources keep what was sent, never fetch, and drive deck conditions", () => {
  const dm = new DataManager();
  const sources = [{ id: "src_cal", alias: "calendar", plugin: "mac-calendar", config: {}, refreshSec: 0 }];
  const updates: string[] = [];
  dm.on("update", (id) => updates.push(id));
  dm.sync(sources);
  const status = () => dm.status().find((s) => s.id === "src_cal")!;
  assert.equal(status().updatedAt, null);
  assert.equal(status().error, null); // no failed fetch attempt

  const scope = () => buildScope(sources, dm.snapshot(), Date.now());
  assert.equal(conditionHolds("{{calendar.hasEvents}}", scope()), false);
  dm.push("src_cal", { hasEvents: true, count: 1, next: { title: "Standup" } });
  assert.deepEqual(updates, ["src_cal"]);
  assert.equal(conditionHolds("{{calendar.hasEvents}}", scope()), true);
  dm.push("src_cal", { hasEvents: false, count: 0, next: null });
  assert.equal(conditionHolds("{{calendar.hasEvents}}", scope()), false);
  assert.equal(conditionHolds("!{{calendar.hasEvents}}", scope()), true);
});

test("Do Not Disturb brightness only ever dims", async () => {
  const { brightnessNow } = await import("./device");
  const { createProject } = await import("../shared/defaults");
  const p = createProject("UTC");
  p.device.brightness = 40;
  const dnd = { enabled: true, until: null, slideId: null, brightness: 10, muteNotifications: true };
  assert.equal(brightnessNow(p, Date.now(), dnd), 10);
  assert.equal(brightnessNow(p, Date.now(), { ...dnd, brightness: 80 }), 40);
  assert.equal(brightnessNow(p, Date.now(), { ...dnd, enabled: false }), 40);
  assert.equal(brightnessNow(p, Date.now(), { ...dnd, brightness: null }), 40);
});
