import AppKit

nonisolated struct PlayerEvent: Sendable {
    let state: String
    let title: String
    let artist: String
    let album: String
    let persistentID: String?
}

struct Track: Equatable {
    let id: String
    let title: String
    let artist: String
    let album: String
}

/// Watches the Music app for track changes. Music broadcasts `com.apple.Music.playerInfo`
/// whenever playback changes, so there's no polling.
final class NowPlayingMonitor {
    var onTrackStart: ((Track) -> Void)?
    private var observer: NSObjectProtocol?
    private var lastTrackID: String?

    func start() {
        guard observer == nil else { return }
        observer = DistributedNotificationCenter.default().addObserver(
            forName: .init("com.apple.Music.playerInfo"), object: nil, queue: .main
        ) { [weak self] note in
            // Copy out plain strings here: userInfo itself can't cross isolation.
            let info = note.userInfo ?? [:]
            let event = PlayerEvent(
                state: info["Player State"] as? String ?? "",
                title: info["Name"] as? String ?? "",
                artist: info["Artist"] as? String ?? "",
                album: info["Album"] as? String ?? "",
                persistentID: (info["PersistentID"] as? NSNumber)?.stringValue
            )
            MainActor.assumeIsolated { self?.handle(event) }
        }
    }

    func stop() {
        if let observer { DistributedNotificationCenter.default().removeObserver(observer) }
        observer = nil
        lastTrackID = nil
    }

    private func handle(_ event: PlayerEvent) {
        // Pause/resume and seeking also post; only a new track while playing counts.
        guard event.state == "Playing", !event.title.isEmpty else { return }
        let id = event.persistentID ?? "\(event.title)|\(event.artist)"
        guard id != lastTrackID else { return }
        lastTrackID = id
        onTrackStart?(Track(id: id, title: event.title, artist: event.artist, album: event.album))
    }

    /// The track Music is on right now, if it's playing or paused.
    static func currentTrack() -> Track? {
        let script = """
        tell application "Music"
            if player state is stopped then return missing value
            set t to current track
            return {persistent ID of t, name of t, artist of t, album of t}
        end tell
        """
        guard let list = run(script), list.numberOfItems == 4 else { return nil }
        let field = { (i: Int) in list.atIndex(i)?.stringValue ?? "" }
        return Track(id: field(1), title: field(2), artist: field(3), album: field(4))
    }

    /// The current track's artwork bytes (JPEG or PNG), if it has any.
    static func currentArtwork() -> Data? {
        let script = """
        tell application "Music"
            if player state is stopped then return missing value
            if (count of artworks of current track) is 0 then return missing value
            return raw data of artwork 1 of current track
        end tell
        """
        // "missing value" comes back as a tiny type descriptor, not image bytes.
        guard let data = run(script)?.data, data.count > 64 else { return nil }
        return data
    }

    /// Runs AppleScript against Music. The first call asks the user for Automation permission.
    private static func run(_ source: String) -> NSAppleEventDescriptor? {
        // Don't launch Music just to ask it something.
        guard NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Music").first != nil else { return nil }
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error { NSLog("morsel: Music script failed: \(error)") }
        return result
    }
}
