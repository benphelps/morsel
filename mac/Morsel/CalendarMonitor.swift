import AppKit
import EventKit

struct CalendarChoice: Identifiable, Hashable {
    let id: String
    let title: String
    let account: String
    let color: NSColor

    static func == (a: Self, b: Self) -> Bool { a.id == b.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// One event, formatted for the display. Times use the Mac's own 12/24-hour setting.
struct CalendarEventOut: Encodable, Equatable {
    let title: String
    let time: String
    let end: String
    let allDay: Bool
    let calendar: String
    let location: String
    let startsIn: String
    /// The shortest form: "25m", "1.5h", "now", "today".
    let until: String
    let minutesUntil: Int
    let isNow: Bool
}

/// What the server's "Calendar (Mac app)" source receives.
struct CalendarPayload: Encodable, Equatable {
    let date: String
    let count: Int
    let hasEvents: Bool
    let next: CalendarEventOut?
    /// The events after `next`, e.g. "then 16:30 Dentist · 18:00 Gym".
    let later: String
    let summary: String
    let events: [CalendarEventOut]

    static let empty = CalendarPayload(date: "", count: 0, hasEvents: false, next: nil, later: "", summary: "", events: [])
}

/// Reads today's remaining events from Calendar (every account set up on this Mac).
final class CalendarMonitor {
    let store = EKEventStore()
    var onChange: (() -> Void)?

    private var timer: Timer?
    private var observer: NSObjectProtocol?

    static var hasAccess: Bool { EKEventStore.authorizationStatus(for: .event) == .fullAccess }
    static var wasDenied: Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        return status == .denied || status == .restricted
    }

    func requestAccess() async -> Bool {
        (try? await store.requestFullAccessToEvents()) ?? false
    }

    /// Calls `onChange` when events change and every minute (so "in 25 min" stays current).
    func start() {
        guard timer == nil else { return }
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.onChange?() }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.onChange?() }
        }
        onChange?()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
    }

    func calendars() -> [CalendarChoice] {
        guard Self.hasAccess else { return [] }
        return store.calendars(for: .event)
            .map { CalendarChoice(id: $0.calendarIdentifier, title: $0.title, account: $0.source.title, color: $0.color) }
            .sorted { ($0.account, $0.title) < ($1.account, $1.title) }
    }

    /// Today's events that haven't ended, from the chosen calendars (all when `only` is empty).
    func today(only: Set<String>, now: Date = Date()) -> CalendarPayload {
        guard Self.hasAccess else { return .empty }
        let cal = Calendar.current
        let start = cal.startOfDay(for: now)
        guard let end = cal.date(byAdding: .day, value: 1, to: start) else { return .empty }
        let calendars = store.calendars(for: .event).filter { only.isEmpty || only.contains($0.calendarIdentifier) }
        guard !calendars.isEmpty else { return .empty }
        let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: calendars))
            .filter { $0.endDate > now }
            // All-day events first, then by start time.
            .sorted { ($0.isAllDay ? 0 : 1, $0.startDate) < ($1.isAllDay ? 0 : 1, $1.startDate) }

        let timeFormat = DateFormatter()
        timeFormat.dateStyle = .none
        timeFormat.timeStyle = .short
        let dayFormat = DateFormatter()
        dayFormat.setLocalizedDateFormatFromTemplate("EEEMMMd")

        let out = events.map { e -> CalendarEventOut in
            let minutes = Int(e.startDate.timeIntervalSince(now) / 60)
            let isNow = !e.isAllDay && e.startDate <= now
            return CalendarEventOut(
                title: e.title ?? "Untitled",
                time: e.isAllDay ? "All day" : timeFormat.string(from: e.startDate),
                end: e.isAllDay ? "" : timeFormat.string(from: e.endDate),
                allDay: e.isAllDay,
                calendar: e.calendar.title,
                location: e.location ?? "",
                startsIn: e.isAllDay ? "today" : isNow ? "now" : "in " + Self.relative(minutes: minutes),
                until: e.isAllDay ? "today" : isNow ? "now" : Self.relative(minutes: minutes),
                minutesUntil: max(0, minutes),
                isNow: isNow
            )
        }
        // "Next" is the first timed event still to come or under way; all-day events only if that's all there is.
        let next = out.first { !$0.allDay } ?? out.first
        let rest = out.filter { $0 != next && !$0.allDay }
        return CalendarPayload(
            date: dayFormat.string(from: now),
            count: out.count,
            hasEvents: !out.isEmpty,
            next: next,
            later: rest.isEmpty ? "" : "then " + rest.map { "\($0.time) \($0.title)" }.joined(separator: " · "),
            summary: out.map { "\($0.time) \($0.title)" }.joined(separator: " · "),
            events: Array(out.prefix(10))
        )
    }

    /// The timed event under way right now (the one ending soonest), for "until this meeting ends".
    func currentEvent(only: Set<String>, now: Date = Date()) -> (title: String, end: Date)? {
        guard Self.hasAccess else { return nil }
        let calendars = store.calendars(for: .event).filter { only.isEmpty || only.contains($0.calendarIdentifier) }
        guard !calendars.isEmpty else { return nil }
        let window = store.predicateForEvents(withStart: now.addingTimeInterval(-86_400), end: now.addingTimeInterval(60), calendars: calendars)
        return store.events(matching: window)
            .filter { !$0.isAllDay && $0.startDate <= now && $0.endDate > now }
            .min { $0.endDate < $1.endDate }
            .map { ($0.title ?? "this event", $0.endDate) }
    }

    /// Compact, for a 64-pixel-wide display: "25m", "1.5h", "3h".
    private static func relative(minutes: Int) -> String {
        if minutes < 60 { return "\(max(1, minutes))m" }
        let hours = Double(minutes) / 60
        let rounded = (hours * 2).rounded() / 2
        return rounded == rounded.rounded() ? "\(Int(rounded))h" : String(format: "%.1fh", rounded)
    }
}
