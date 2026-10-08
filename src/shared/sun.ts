// Sunrise and sunset from a place and the date alone (the standard sunrise
// equation), for day and night in the clock source. Good to a minute or two.

const DAY = 86_400_000;
const RAD = Math.PI / 180;
/** Julian day number of the Unix epoch. */
const J1970 = 2440587.5;
/** Julian day number of 1 January 2000, 12:00. */
const J2000 = 2451545;

export interface SunTimes {
  /** Today's sunrise and sunset (epoch ms), or null when the sun doesn't rise or set today. */
  rise: number | null;
  set: number | null;
  /** In a polar day or night, which it is all day. */
  always?: "day" | "night";
}

/**
 * The sunrise and sunset around `epochMs` at a place (degrees, east and north
 * positive): those of the solar day it's in, from one local midnight to the next.
 */
export function sunTimes(epochMs: number, lat: number, lon: number): SunTimes {
  const jd = epochMs / DAY + J1970;
  // The local solar noon nearest to now.
  const n = Math.round(jd - J2000 - 0.0009 + lon / 360);
  const mean = n + 0.0009 - lon / 360;
  const M = (357.5291 + 0.98560028 * mean) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = J2000 + mean + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * L * RAD);
  const decl = Math.asin(Math.sin(L * RAD) * Math.sin(23.4397 * RAD));
  // The sun's centre 0.833° below the horizon: refraction and its own size.
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) / (Math.cos(lat * RAD) * Math.cos(decl));
  if (cosH < -1) return { rise: null, set: null, always: "day" };
  if (cosH > 1) return { rise: null, set: null, always: "night" };
  const half = Math.acos(cosH) / RAD / 360;
  const ms = (j: number) => Math.round((j - J1970) * DAY);
  return { rise: ms(transit - half), set: ms(transit + half) };
}

