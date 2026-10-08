import Foundation

/// What `POST /api/notify` accepts. Everything is optional; the server picks a layout.
struct NotifyPayload: Encodable, Equatable {
    var title: String?
    var subtitle: String?
    var text: String?
    /// Sending app's name, shown small.
    var app: String?
    /// A built-in morsel icon name.
    var icon: String?
    /// PNG as base64.
    var image: String?
    /// "#rrggbb"
    var color: String?
    var durationSec: Int?
    /// nil for a banner, "nowplaying" for album-art cards.
    var style: String?
}

struct DndInfo: Decodable, Equatable {
    let enabled: Bool
    /// Epoch milliseconds, when it ends.
    let until: Double?
}

struct DeviceStatus: Decodable {
    struct Current: Decodable {
        let name: String
    }

    let connected: Bool
    let current: Current?
    let dnd: DndInfo?
}

/// POST /api/dnd. Missing fields are left as they are.
struct DndPatch: Encodable {
    var enabled: Bool?
    var minutes: Int?
    /// Epoch milliseconds.
    var until: Double?
}

enum ClientError: LocalizedError {
    case badAddress
    case server(String)
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .badAddress: "The server address isn't a valid URL."
        case .server(let message): message
        case .http(let code): "The server replied with HTTP \(code)."
        }
    }
}

private struct ErrorReply: Decodable {
    let error: String?
}

/// Talks to the morsel server's HTTP API.
struct MorselClient {
    let baseURL: URL

    init(address: String) throws {
        var trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.contains("://") { trimmed = "http://" + trimmed }
        guard let url = URL(string: trimmed), url.host != nil else { throw ClientError.badAddress }
        baseURL = url
    }

    /// Shows a notification now; returns how many seconds it stays up.
    func notify(_ payload: NotifyPayload) async throws -> Int {
        struct Reply: Decodable {
            let durationSec: Int?
            let error: String?
        }
        let (data, http) = try await send("api/notify", method: "POST", body: try JSONEncoder().encode(payload))
        let reply = try? JSONDecoder().decode(Reply.self, from: data)
        guard (200..<300).contains(http.statusCode) else {
            throw reply?.error.map(ClientError.server) ?? ClientError.http(http.statusCode)
        }
        return reply?.durationSec ?? 8
    }

    /// Sends data for a push source (e.g. "mac-calendar"); the server creates the source if needed.
    func push<T: Encodable>(_ plugin: String, _ data: T) async throws {
        let (body, http) = try await send("api/push/\(plugin)", method: "POST", body: try JSONEncoder().encode(data))
        guard (200..<300).contains(http.statusCode) else {
            throw (try? JSONDecoder().decode(ErrorReply.self, from: body))?.error.map(ClientError.server) ?? ClientError.http(http.statusCode)
        }
    }

    func setDnd(_ patch: DndPatch) async throws -> DndInfo {
        let (data, http) = try await send("api/dnd", method: "POST", body: try JSONEncoder().encode(patch))
        guard (200..<300).contains(http.statusCode) else {
            throw (try? JSONDecoder().decode(ErrorReply.self, from: data))?.error.map(ClientError.server) ?? ClientError.http(http.statusCode)
        }
        return try JSONDecoder().decode(DndInfo.self, from: data)
    }

    func status() async throws -> DeviceStatus {
        let (data, http) = try await send("api/device")
        guard http.statusCode == 200 else { throw ClientError.http(http.statusCode) }
        return try JSONDecoder().decode(DeviceStatus.self, from: data)
    }

    private func send(_ path: String, method: String = "GET", body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: baseURL.appending(path: path), timeoutInterval: 15)
        request.httpMethod = method
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ClientError.http(0) }
        return (data, http)
    }
}
