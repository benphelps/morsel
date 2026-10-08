import type { FetchPlugin } from "./types";

const sampleEvents = [
  { title: "Standup", time: "10:00", end: "10:15", allDay: false, calendar: "Work", location: "", startsIn: "in 25m", until: "25m", minutesUntil: 25, isNow: false },
  { title: "Dentist", time: "16:30", end: "17:15", allDay: false, calendar: "Personal", location: "Main St", startsIn: "in 7h", until: "7h", minutesUntil: 415, isNow: false },
];

/** Today's events, sent by the morsel Mac app from Calendar (EventKit). */
export const macCalendarPlugin: FetchPlugin = {
  info: {
    id: "mac-calendar",
    name: "Calendar (Mac app)",
    description: "Today's remaining events from Calendar on your Mac, sent by the morsel menu bar app. Turn it on in the app's Calendar settings.",
    live: false,
    push: true,
    defaultAlias: "calendar",
    defaultRefreshSec: 0,
    fields: [],
    defaultConfig: {},
    sample: {
      date: "Tue Sep 29",
      count: 2,
      hasEvents: true,
      next: sampleEvents[0],
      later: "then 16:30 Dentist",
      summary: "10:00 Standup · 16:30 Dentist",
      events: sampleEvents,
    },
  },
  // Push plugins are never fetched; the data manager keeps whatever was last sent.
  async fetch() {
    throw new Error("Waiting for the Mac app to send events");
  },
};
