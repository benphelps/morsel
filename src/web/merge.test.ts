import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createProject, createSlide } from "../shared/defaults";
import type { Project } from "../shared/types";
import { merge3 } from "./merge";

const clone = <T>(v: T): T => structuredClone(v);

test("edits to different slides and elements are all kept", () => {
  const base = createProject("UTC");
  const mine = clone(base);
  const theirs = clone(base);
  mine.slides[0].elements[0].state.x = 11; // we move the clock's time
  theirs.slides[1].name = "Hi"; // they rename another slide
  theirs.slides.push(createSlide("Ball")); // and add one
  const { value, conflicts } = merge3(base, mine, theirs);
  assert.equal(conflicts, 0);
  assert.equal(value.slides[0].elements[0].state.x, 11);
  assert.equal(value.slides[1].name, "Hi");
  assert.deepEqual(
    value.slides.map((s) => s.name),
    ["Clock", "Hi", ...base.slides.slice(2).map((s) => s.name), "Ball"],
  );
});

test("both sides adding things keeps both, in place", () => {
  const base = createProject("UTC");
  const mine = clone(base);
  const theirs = clone(base);
  mine.slides[0].elements.push(createElement("rect", { name: "Mine" }));
  theirs.slides[0].elements.push(createElement("ellipse", { name: "Theirs" }));
  const { value } = merge3(base, mine, theirs);
  assert.deepEqual(
    value.slides[0].elements.map((e) => e.name),
    ["Time", "Date", "Mine", "Theirs"],
  );
});

test("the same value changed on both sides keeps ours and counts a conflict", () => {
  const base = createProject("UTC");
  const mine = clone(base);
  const theirs = clone(base);
  mine.slides[0].durationSec = 12;
  theirs.slides[0].durationSec = 5;
  theirs.slides[0].background = "#112233"; // a different field of the same slide still merges
  const { value, conflicts } = merge3(base, mine, theirs);
  assert.equal(conflicts, 1);
  assert.equal(value.slides[0].durationSec, 12);
  assert.equal(value.slides[0].background, "#112233");
});

test("deletes: theirs is honoured unless we changed the item; ours always wins", () => {
  const base = createProject("UTC");
  const theirs = clone(base);
  theirs.slides = theirs.slides.slice(1); // they delete the clock slide
  const untouched = merge3(base, clone(base), theirs);
  assert.equal(untouched.value.slides.length, base.slides.length - 1);

  const edited = clone(base);
  edited.slides[0].name = "Still needed";
  const kept = merge3(base, edited, theirs);
  assert.equal(kept.value.slides[0].name, "Still needed");
  assert.equal(kept.conflicts, 1);

  const mine = clone(base);
  mine.slides = mine.slides.slice(1);
  const changedByThem = clone(base);
  changedByThem.slides[0].name = "Renamed";
  const gone = merge3(base, mine, changedByThem);
  assert.equal(gone.value.slides.length, base.slides.length - 1);
});

test("a reorder on their side is kept when we didn't reorder", () => {
  const base: Project = createProject("UTC");
  const theirs = clone(base);
  theirs.slides.reverse();
  const mine = clone(base);
  mine.slides[0].name = "Clock 2";
  const { value } = merge3(base, mine, theirs);
  assert.deepEqual(
    value.slides.map((s) => s.name),
    [...base.slides.slice(1).map((s) => s.name).reverse(), "Clock 2"],
  );
});
