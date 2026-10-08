import AppKit
import Observation
import ServiceManagement

/// A notification the forwarder saw, and what happened to it (for Settings → Notifications).
struct SeenItem: Identifiable {
    enum Outcome: String { case forwarded = "Forwarded", notInList = "App not ticked", unreadable = "Couldn't read" }

    let id = UUID()
    let appID: String
    let appName: String
    let title: String
    let outcome: Outcome
    let date = Date()
}

struct SentItem: Identifiable {
    enum Kind { case music, notification }

    let id = UUID()
    let kind: Kind
    let title: String
    let detail: String
    let appID: String?
    let date = Date()
    var error: String?
}

@Observable
final class AppState {
    // MARK: Settings (persisted)

    var serverAddress: String = UserDefaults.standard.string(forKey: "serverAddress") ?? "http://localhost:8000" {
        didSet {
            UserDefaults.standard.set(serverAddress, forKey: "serverAddress")
            Task { await refreshStatus() }
        }
    }

    var nowPlayingEnabled: Bool = UserDefaults.standard.bool(forKey: "nowPlayingEnabled") {
        didSet {
            UserDefaults.standard.set(nowPlayingEnabled, forKey: "nowPlayingEnabled")
            nowPlayingEnabled ? nowPlaying.start() : nowPlaying.stop()
        }
    }

    var forwardingEnabled: Bool = UserDefaults.standard.bool(forKey: "forwardingEnabled") {
        didSet {
            UserDefaults.standard.set(forwardingEnabled, forKey: "forwardingEnabled")
            forwardingEnabled ? forwarder.start() : forwarder.stop()
            // Turning it on without access walks the user through granting it.
            if forwardingEnabled, forwarderStatus == .needsAccess { requestFullDiskAccess() }
            if !forwardingEnabled { accessGuide.cancel() }
        }
    }

    var calendarEnabled: Bool = UserDefaults.standard.bool(forKey: "calendarEnabled") {
        didSet {
            UserDefaults.standard.set(calendarEnabled, forKey: "calendarEnabled")
            Task { await updateCalendar() }
        }
    }

    /// Calendar identifiers to include; empty means all of them.
    var calendarIDs: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "calendarIDs") ?? []) {
        didSet {
            UserDefaults.standard.set(Array(calendarIDs), forKey: "calendarIDs")
            pushCalendar()
        }
    }

    /// Bundle ids whose notifications go to the Tidbyt.
    var forwardedApps: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "forwardedApps") ?? []) {
        didSet { UserDefaults.standard.set(Array(forwardedApps), forKey: "forwardedApps") }
    }

    var launchAtLogin: Bool {
        get { SMAppService.mainApp.status == .enabled }
        set {
            do {
                if newValue { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            } catch {
                lastError = error.localizedDescription
            }
        }
    }

    // MARK: Live state

    var device: DeviceStatus?
    var dnd: DndInfo?
    var serverReachable = false
    var recent: [SentItem] = []
    var forwarderStatus: ForwarderStatus = .off
    var knownApps: [NotifyingApp] = []
    var seen: [SeenItem] = []
    var calendars: [CalendarChoice] = []
    var calendarToday: CalendarPayload?
    var calendarNeedsAccess = false
    var lastError: String?

    private let nowPlaying = NowPlayingMonitor()
    private let forwarder = NotificationForwarder()
    private let accessGuide = FullDiskAccessGuide()
    private let calendarMonitor = CalendarMonitor()
    private var queue: [(payload: NotifyPayload, item: SentItem)] = []
    private var draining = false

    init() {
        nowPlaying.onTrackStart = { [weak self] track in self?.trackStarted(track) }
        forwarder.onNotification = { [weak self] note in self?.notificationDelivered(note) }
        forwarder.onUnreadable = { [weak self] record in
            guard let self else { return }
            recordSeen(SeenItem(appID: record.appID, appName: Self.appName(bundleID: record.appID), title: "", outcome: .unreadable), detail: record.shape)
        }
        forwarder.onStatus = { [weak self] status in
            self?.forwarderStatus = status
            self?.log("status \(status)")
        }
        forwarder.onDebug = { [weak self] message in self?.log(message) }
        accessGuide.isGranted = { NotificationForwarder.canRead() }
        accessGuide.onGranted = { [weak self] in
            guard let self else { return }
            if forwardingEnabled { retryForwarding() } else { forwardingEnabled = true }
            refreshKnownApps()
            NSApp.activate()
        }
        calendarMonitor.onChange = { [weak self] in self?.pushCalendar() }
        if calendarEnabled { Task { await updateCalendar() } }
        if nowPlayingEnabled { nowPlaying.start() }
        if forwardingEnabled { forwarder.start() }
        Task {
            while true {
                await refreshStatus()
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    // MARK: Sending

    /// Sends whatever Music is playing right now, ignoring the "new track" check.
    func sendCurrentTrack() {
        guard let track = NowPlayingMonitor.currentTrack() else {
            lastError = "Music isn't playing anything."
            return
        }
        trackStarted(track)
    }

    func sendTestNotification() {
        enqueue(
            NotifyPayload(title: "morsel", subtitle: "Test notification", text: "Forwarding works.", app: "morsel", image: Self.appIconPNG(bundleID: Bundle.main.bundleIdentifier ?? "")),
            SentItem(kind: .notification, title: "Test notification", detail: "", appID: Bundle.main.bundleIdentifier)
        )
    }

    private func trackStarted(_ track: Track) {
        let art = NowPlayingMonitor.currentArtwork().flatMap { NSImage(data: $0) }.flatMap { $0.pngBase64(fitting: 256) }
        let payload = NotifyPayload(title: track.title, subtitle: track.artist, app: track.album.isEmpty ? nil : track.album, image: art, style: "nowplaying")
        // A newer track replaces one that hasn't been shown yet.
        queue.removeAll { $0.item.kind == .music }
        enqueue(payload, SentItem(kind: .music, title: track.title, detail: track.artist, appID: "com.apple.Music"))
    }

    private func notificationDelivered(_ note: DeliveredNotification) {
        let appName = knownApps.first { $0.id.lowercased() == note.appID }?.name ?? Self.appName(bundleID: note.appID)
        // Bundle ids are compared case-insensitively: Notification Center lowercases them.
        guard forwardedApps.contains(where: { $0.lowercased() == note.appID }) else {
            recordSeen(SeenItem(appID: note.appID, appName: appName, title: note.title, outcome: .notInList), detail: "")
            return
        }
        recordSeen(SeenItem(appID: note.appID, appName: appName, title: note.title, outcome: .forwarded), detail: "")
        let payload = NotifyPayload(
            title: note.title.isEmpty ? appName : note.title,
            subtitle: note.subtitle.isEmpty ? nil : note.subtitle,
            text: note.body.isEmpty ? nil : note.body,
            app: appName,
            image: Self.appIconPNG(bundleID: note.appID)
        )
        enqueue(payload, SentItem(kind: .notification, title: payload.title ?? appName, detail: note.body, appID: note.appID))
    }

    /// Notifications are shown one at a time: each waits for the previous one's duration.
    private func enqueue(_ payload: NotifyPayload, _ item: SentItem) {
        queue.append((payload, item))
        if queue.count > 10 { queue.removeFirst(queue.count - 10) }
        guard !draining else { return }
        draining = true
        Task {
            while !queue.isEmpty {
                var (payload, item) = queue.removeFirst()
                var wait = 0
                do {
                    wait = try await MorselClient(address: serverAddress).notify(payload)
                    lastError = nil
                } catch {
                    item.error = error.localizedDescription
                    lastError = error.localizedDescription
                }
                recent.insert(item, at: 0)
                recent = Array(recent.prefix(8))
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            }
            draining = false
        }
    }

    // MARK: Do Not Disturb

    /// The meeting under way now, if Calendar is on, for "until it ends".
    var currentMeeting: (title: String, end: Date)? {
        calendarEnabled ? calendarMonitor.currentEvent(only: calendarIDs) : nil
    }

    func setDnd(_ patch: DndPatch) {
        Task {
            do {
                dnd = try await MorselClient(address: serverAddress).setDnd(patch)
                lastError = nil
            } catch {
                lastError = "Do Not Disturb: \(error.localizedDescription)"
            }
        }
    }

    // MARK: Calendar

    /// Starts or stops sending today's events, asking for Calendar access the first time.
    func updateCalendar() async {
        guard calendarEnabled else {
            calendarMonitor.stop()
            calendarToday = nil
            // Tell the server there's nothing, so calendar slides drop out of the deck.
            try? await MorselClient(address: serverAddress).push("mac-calendar", CalendarPayload.empty)
            return
        }
        if !CalendarMonitor.hasAccess, !CalendarMonitor.wasDenied {
            _ = await calendarMonitor.requestAccess()
        }
        calendarNeedsAccess = !CalendarMonitor.hasAccess
        guard !calendarNeedsAccess else { return }
        calendars = calendarMonitor.calendars()
        calendarMonitor.start()
    }

    private func pushCalendar() {
        guard calendarEnabled, CalendarMonitor.hasAccess else { return }
        let payload = calendarMonitor.today(only: calendarIDs)
        calendarToday = payload
        Task {
            do {
                try await MorselClient(address: serverAddress).push("mac-calendar", payload)
            } catch {
                lastError = "Calendar: \(error.localizedDescription)"
            }
        }
    }

    // MARK: Diagnostics

    private static let logURL = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Logs/morsel/forwarder.log")

    /// Keeps the last few for Settings, and logs app id + outcome (never the text) for troubleshooting.
    private func recordSeen(_ item: SeenItem, detail: String) {
        seen.insert(item, at: 0)
        seen = Array(seen.prefix(20))
        log("\(item.appID)\t\(item.outcome.rawValue)\t\(detail)")
    }

    private func log(_ message: String) {
        let line = "\(ISO8601DateFormatter().string(from: Date()))\t\(message)\n"
        let url = Self.logURL
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? Data(line.utf8).write(to: url)
        }
    }

    // MARK: Status

    func refreshStatus() async {
        do {
            let client = try MorselClient(address: serverAddress)
            device = try await client.status()
            dnd = device?.dnd
            serverReachable = true
        } catch {
            device = nil
            serverReachable = false
        }
    }

    func refreshKnownApps() {
        knownApps = forwarder.knownApps()
    }

    /// Opens System Settings with a drag-in helper and waits for access.
    func requestFullDiskAccess() {
        accessGuide.begin()
    }

    /// Re-checks Full Disk Access after the user grants it.
    func retryForwarding() {
        forwarder.stop()
        if forwardingEnabled { forwarder.start() }
        refreshKnownApps()
    }

    // MARK: Helpers

    static func appName(bundleID: String) -> String {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else { return bundleID }
        return FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")
    }

    static func appIcon(bundleID: String) -> NSImage? {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else { return nil }
        return NSWorkspace.shared.icon(forFile: url.path)
    }

    static func appIconPNG(bundleID: String) -> String? {
        appIcon(bundleID: bundleID)?.pngBase64(size: 64)
    }
}

extension NSImage {
    /// Redraws the image at size×size and returns it as base64 PNG, small enough to send quickly.
    func pngBase64(size: Int) -> String? {
        pngBase64(width: size, height: size)
    }

    /// Shrinks the image (never enlarges) so its longer side is at most `maxSide`, keeping its shape.
    /// Album art goes up like this so the server can do the one real reduction to the panel's size.
    func pngBase64(fitting maxSide: Int) -> String? {
        // Pixel size of the best representation; `size` is in points and can disagree.
        let pixels = representations.map { CGSize(width: $0.pixelsWide, height: $0.pixelsHigh) }.max { $0.width * $0.height < $1.width * $1.height }
        let source = (pixels?.width ?? 0) > 0 ? pixels! : size
        guard source.width > 0, source.height > 0 else { return nil }
        let k = min(1, CGFloat(maxSide) / max(source.width, source.height))
        return pngBase64(width: max(1, Int((source.width * k).rounded())), height: max(1, Int((source.height * k).rounded())))
    }

    private func pngBase64(width: Int, height: Int) -> String? {
        // Tagged sRGB so colours are converted properly (and the server reads them as sRGB).
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
            hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        )?.retagging(with: .sRGB) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSGraphicsContext.current?.imageInterpolation = .high
        draw(in: NSRect(x: 0, y: 0, width: width, height: height), from: .zero, operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])?.base64EncodedString()
    }
}
