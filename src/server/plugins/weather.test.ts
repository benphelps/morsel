import assert from "node:assert/strict";
import { test } from "node:test";
import { atmosphere } from "./weather";

test("weather codes map to simple flags and an effect", () => {
  assert.deepEqual(atmosphere(63, true), { isRaining: true, isSnowing: false, isClearNight: false, effect: "rain" }); // rain
  assert.equal(atmosphere(53, true).effect, "rain"); // drizzle counts
  assert.equal(atmosphere(95, false).effect, "rain"); // thunderstorm counts
  assert.deepEqual(atmosphere(73, false), { isRaining: false, isSnowing: true, isClearNight: false, effect: "snow" });
  assert.equal(atmosphere(86, true).effect, "snow"); // snow showers
  assert.deepEqual(atmosphere(0, false), { isRaining: false, isSnowing: false, isClearNight: true, effect: "stars" });
  assert.equal(atmosphere(1, true).effect, "none"); // clear, but daytime
  assert.equal(atmosphere(2, true).effect, "clouds"); // partly cloudy
  assert.equal(atmosphere(3, false).effect, "overcast");
  assert.equal(atmosphere(45, true).effect, "overcast"); // fog
  assert.equal(atmosphere(48, false).effect, "overcast"); // rime fog
});
