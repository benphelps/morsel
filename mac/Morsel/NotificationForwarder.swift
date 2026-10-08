import AppKit
import SQLite3

struct DeliveredNotification {
    let appID: String
    let title: String
    let subtitle: String
    let body: String
}

/// Something the forwarder picked up that it couldn't turn into a notification, for diagnostics.
struct UnreadableRecord {
    let appID: String
    /// Top-level plist keys (and the request's keys), never values.
    let shape: String
}

struct NotifyingApp: Identifiable, Hashable {
    let id: String // bundle identifier
    let name: String
}

enum ForwarderStatus: Equatable {
    case off
    /// Full Disk Access hasn't been granted yet.
    case needsAccess
    case running
    /// The database was readable but not in a shape we understand (e.g. a new macOS).
    case failed(String)
}

/// Reads new notifications from Notification Center's database.
///
/// macOS has no public API for other apps' notifications. Notification Center
/// keeps them in a SQLite database under Group Containers, readable once the app
/// has Full Disk Access. The format is undocumented and may change with macOS.
final class NotificationForwarder {
    static let databasePath = FileManager.default.homeDirectoryForCurrentUser
        .appending(path: "Library/Group Containers/group.com.apple.usernoted/db2/db").path

    var onNotification: ((DeliveredNotification) -> Void)?
    var onUnreadable: ((UnreadableRecord) -> Void)?
    /// Low-level events for the diagnostic log.
    var onDebug: ((String) -> Void)?
    var onStatus: ((ForwarderStatus) -> Void)?

    private var db: OpaquePointer?
    private var lastRecordID: Int64 = 0
    /// A slow safety net in case a file event is ever missed.
    private var fallback: Timer?
    private var watchers: [DispatchSourceFileSystemObject] = []
    private var readScheduled = false

    func start() {
        guard fallback == nil else { return }
        guard let latest = openAndReadLatestID() else { return }
        // Only forward what arrives from now on, never the backlog.
        lastRecordID = latest
        onDebug?("started; newest record \(latest)")
        onStatus?(.running)
        watchFiles()
        fallback = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.watchers.isEmpty { self.watchFiles() }
                self.poll()
            }
        }
    }

    func stop() {
        fallback?.invalidate()
        fallback = nil
        stopWatching()
        close()
        onStatus?(.off)
    }

    /// Reads as soon as Notification Center writes; the timer is only a fallback.
    /// New notifications land in the write-ahead log (db-wal) and move to db on checkpoints.
    private func watchFiles() {
        stopWatching()
        let folder = (Self.databasePath as NSString).deletingLastPathComponent
        for name in ["db-wal", "db"] {
            let fd = open((folder as NSString).appendingPathComponent(name), O_EVTONLY)
            guard fd >= 0 else { continue }
            let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .extend, .delete, .rename], queue: .main)
            source.setEventHandler { [weak self, weak source] in
                MainActor.assumeIsolated {
                    guard let self, let source else { return }
                    // SQLite can replace the log file; follow the new one.
                    if !source.data.isDisjoint(with: [.delete, .rename]) { self.watchFiles() }
                    self.scheduleRead()
                }
            }
            source.setCancelHandler { Darwin.close(fd) }
            source.resume()
            watchers.append(source)
        }
        onDebug?("watching \(watchers.count) database files")
    }

    private func stopWatching() {
        watchers.forEach { $0.cancel() }
        watchers.removeAll()
    }

    /// One write usually comes as several events; read once they settle.
    private func scheduleRead() {
        guard !readScheduled else { return }
        readScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            MainActor.assumeIsolated {
                self?.readScheduled = false
                self?.poll()
            }
        }
    }

    /// Whether the database can be read right now (i.e. Full Disk Access is in effect).
    static func canRead() -> Bool {
        var handle: OpaquePointer?
        defer { if let handle { sqlite3_close(handle) } }
        guard sqlite3_open_v2(databasePath, &handle, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let handle else { return false }
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, "SELECT 1 FROM record LIMIT 1", -1, &stmt, nil) == SQLITE_OK else { return false }
        defer { sqlite3_finalize(stmt) }
        let rc = sqlite3_step(stmt)
        return rc == SQLITE_ROW || rc == SQLITE_DONE
    }

    /// Apps that have posted notifications before, for the allow list.
    func knownApps() -> [NotifyingApp] {
        guard db != nil || openAndReadLatestID() != nil else { return [] }
        var apps: [NotifyingApp] = []
        query("SELECT identifier FROM app") { stmt in
            guard let id = Self.text(stmt, 0), let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else { return }
            let name = FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")
            apps.append(NotifyingApp(id: id, name: name))
        }
        return Set(apps).sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func poll() {
        var found: [DeliveredNotification] = []
        var unreadable: [UnreadableRecord] = []
        let ok = query(
            "SELECT r.rec_id, a.identifier, r.data FROM record r JOIN app a ON a.app_id = r.app_id WHERE r.rec_id > \(lastRecordID) ORDER BY r.rec_id LIMIT 50"
        ) { stmt in
            lastRecordID = max(lastRecordID, sqlite3_column_int64(stmt, 0))
            let appID = Self.text(stmt, 1) ?? ""
            guard let bytes = sqlite3_column_blob(stmt, 2) else {
                unreadable.append(UnreadableRecord(appID: appID, shape: "no data"))
                return
            }
            let blob = Data(bytes: bytes, count: Int(sqlite3_column_bytes(stmt, 2)))
            if let note = Self.parse(blob, appID: appID) { found.append(note) } else { unreadable.append(UnreadableRecord(appID: appID, shape: Self.shape(of: blob))) }
        }
        if !ok { return }
        if !found.isEmpty || !unreadable.isEmpty { onDebug?("poll: \(found.count) readable, \(unreadable.count) unreadable, now at \(lastRecordID)") }
        found.forEach { onNotification?($0) }
        unreadable.forEach { onUnreadable?($0) }
    }

    /// Each record's `data` is a binary plist: {app, req: {titl, subt, body, …}, …}.
    /// The app id comes from the `app` table, which is also what the allow list holds;
    /// the plist's own copy can differ in case (com.hnc.Discord vs com.hnc.discord).
    static func parse(_ blob: Data, appID: String) -> DeliveredNotification? {
        guard let plist = try? PropertyListSerialization.propertyList(from: blob, format: nil) as? [String: Any] else { return nil }
        let request = plist["req"] as? [String: Any] ?? [:]
        let title = request["titl"] as? String ?? ""
        let subtitle = request["subt"] as? String ?? ""
        let body = request["body"] as? String ?? ""
        guard !(title.isEmpty && subtitle.isEmpty && body.isEmpty) else { return nil }
        let id = appID.isEmpty ? (plist["app"] as? String ?? "") : appID
        return DeliveredNotification(appID: id.lowercased(), title: title, subtitle: subtitle, body: body)
    }

    /// Describes a record's structure (keys only) so format changes can be diagnosed without reading content.
    static func shape(of blob: Data) -> String {
        guard let root = try? PropertyListSerialization.propertyList(from: blob, format: nil) else { return "not a plist (\(blob.count) bytes)" }
        guard let dict = root as? [String: Any] else { return "plist \(type(of: root))" }
        let keys = dict.keys.sorted().joined(separator: ",")
        let req = (dict["req"] as? [String: Any])?.keys.sorted().joined(separator: ",") ?? "-"
        return "keys [\(keys)] req [\(req)]"
    }

    // MARK: SQLite

    /// Opens the database read-only and returns the newest record id, reporting why if it can't.
    private func openAndReadLatestID() -> Int64? {
        close()
        var handle: OpaquePointer?
        let rc = sqlite3_open_v2(Self.databasePath, &handle, SQLITE_OPEN_READONLY, nil)
        db = handle
        if rc != SQLITE_OK {
            report(rc: rc)
            close()
            return nil
        }
        var latest: Int64 = 0
        guard query("SELECT IFNULL(MAX(rec_id), 0) FROM record", { latest = sqlite3_column_int64($0, 0) }) else {
            close()
            return nil
        }
        return latest
    }

    @discardableResult
    private func query(_ sql: String, _ row: (OpaquePointer) -> Void) -> Bool {
        guard let db else { return false }
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            report(rc: sqlite3_errcode(db))
            return false
        }
        defer { sqlite3_finalize(stmt) }
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_ROW { row(stmt); continue }
            if rc == SQLITE_DONE { return true }
            report(rc: rc)
            return false
        }
    }

    private func report(rc: Int32) {
        let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? String(cString: sqlite3_errstr(rc))
        onDebug?("sqlite error \(rc): \(message)")
        // Without Full Disk Access, macOS refuses at open or first read with an authorization error.
        let denied = rc == SQLITE_AUTH || rc == SQLITE_CANTOPEN || rc == SQLITE_PERM || message.localizedCaseInsensitiveContains("authorization")
        onStatus?(denied ? .needsAccess : .failed(message))
    }

    private func close() {
        if let db { sqlite3_close(db) }
        db = nil
    }

    private static func text(_ stmt: OpaquePointer, _ column: Int32) -> String? {
        sqlite3_column_text(stmt, column).map { String(cString: $0) }
    }
}
