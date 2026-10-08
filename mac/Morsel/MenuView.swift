import SwiftUI

struct MenuView: View {
    @Environment(AppState.self) private var state
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        @Bindable var state = state
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

            Divider()

            DndRow()
                .padding(.horizontal, 14)
                .padding(.vertical, 10)

            Divider()

            VStack(spacing: 10) {
                FeatureToggle(title: "Now Playing", subtitle: "Show new songs from Music", systemImage: "music.note", isOn: $state.nowPlayingEnabled)
                FeatureToggle(title: "Forward notifications", subtitle: forwardingSubtitle, systemImage: "bell.badge", isOn: $state.forwardingEnabled)
                FeatureToggle(title: "Calendar", subtitle: calendarSubtitle, systemImage: "calendar", isOn: $state.calendarEnabled)
                if state.forwardingEnabled, state.forwarderStatus == .needsAccess {
                    HStack {
                        Text("Forwarding needs Full Disk Access.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Grant Access…") { state.requestFullDiskAccess() }
                            .controlSize(.small)
                    }
                }
                if let error = state.lastError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            if !state.recent.isEmpty {
                Divider()
                RecentList(items: state.recent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
            }

            Divider()

            HStack {
                Button("Settings…") {
                    NSApp.activate()
                    openSettings()
                }
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
            }
            .buttonStyle(.borderless)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
        }
        .frame(width: 340)
        .task { await state.refreshStatus() }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "circle.grid.3x3.fill")
                .font(.title2)
                .foregroundStyle(.orange.gradient)
            VStack(alignment: .leading, spacing: 1) {
                Text("morsel").font(.headline)
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Circle()
                .fill(state.device?.connected == true ? Color.green : state.serverReachable ? Color.orange : Color.red)
                .frame(width: 8, height: 8)
                .help(statusText)
        }
    }

    private var statusText: String {
        guard state.serverReachable else { return "Can't reach \(state.serverAddress)" }
        guard let device = state.device, device.connected else { return "Server up · Tidbyt offline" }
        if let current = device.current { return "Showing \(current.name)" }
        return "Tidbyt connected"
    }

    private var calendarSubtitle: String {
        guard state.calendarEnabled else { return "Show today's events" }
        if state.calendarNeedsAccess { return "Needs Calendar access (see Settings)" }
        guard let today = state.calendarToday else { return "Reading your calendars…" }
        guard let next = today.next else { return "No more events today" }
        let count = today.count == 1 ? "1 event" : "\(today.count) events"
        return "\(count) · next \(next.time) \(next.title)"
    }

    private var forwardingSubtitle: String {
        switch state.forwarderStatus {
        case .needsAccess: "Needs Full Disk Access (see Settings)"
        case .failed: "Couldn't read notifications (see Settings)"
        default: state.forwardedApps.isEmpty ? "Choose apps in Settings" : "\(state.forwardedApps.count) app\(state.forwardedApps.count == 1 ? "" : "s")"
        }
    }
}

private struct FeatureToggle: View {
    let title: String
    let subtitle: String
    let systemImage: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .frame(width: 26, height: 26)
                .background(isOn ? Color.accentColor : Color.secondary.opacity(0.2), in: Circle())
                .foregroundStyle(isOn ? .white : .secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Toggle(title, isOn: $isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct RecentList: View {
    let items: [SentItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Recent").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(items.prefix(5)) { item in
                HStack(spacing: 8) {
                    icon(for: item)
                        .frame(width: 18, height: 18)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(item.title).lineLimit(1)
                        if let error = item.error {
                            Text(error).font(.caption).foregroundStyle(.red).lineLimit(1)
                        } else if !item.detail.isEmpty {
                            Text(item.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    Spacer()
                    Text(item.date, style: .relative)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .monospacedDigit()
                }
            }
        }
    }

    @ViewBuilder
    private func icon(for item: SentItem) -> some View {
        if let appID = item.appID, let image = AppState.appIcon(bundleID: appID) {
            Image(nsImage: image).resizable()
        } else {
            Image(systemName: item.kind == .music ? "music.note" : "text.bubble")
                .foregroundStyle(.secondary)
        }
    }
}

/// Do Not Disturb: a switch, plus durations (including "until this meeting ends").
private struct DndRow: View {
    @Environment(AppState.self) private var state

    var body: some View {
        let on = state.dnd?.enabled == true
        HStack(spacing: 10) {
            Image(systemName: "moon.fill")
                .frame(width: 26, height: 26)
                .background(on ? Color.indigo : Color.secondary.opacity(0.2), in: Circle())
                .foregroundStyle(on ? .white : .secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text("Do Not Disturb")
                Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Menu {
                Button("For 30 minutes") { state.setDnd(DndPatch(minutes: 30)) }
                Button("For 1 hour") { state.setDnd(DndPatch(minutes: 60)) }
                Button("For 2 hours") { state.setDnd(DndPatch(minutes: 120)) }
                if let meeting = state.currentMeeting {
                    Divider()
                    Button("Until \u{201C}\(meeting.title)\u{201D} ends (\(meeting.end.formatted(date: .omitted, time: .shortened)))") {
                        state.setDnd(DndPatch(enabled: true, until: meeting.end.timeIntervalSince1970 * 1000))
                    }
                }
                Divider()
                Button("Until I turn it off") { state.setDnd(DndPatch(enabled: true, until: nil)) }
            } label: {
                Image(systemName: "clock")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Turn on for a while")
            Toggle("Do Not Disturb", isOn: Binding(get: { on }, set: { state.setDnd(DndPatch(enabled: $0)) }))
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
        }
        .frame(maxWidth: .infinity)
    }

    private var subtitle: String {
        guard let dnd = state.dnd, dnd.enabled else { return "Pause the deck on one calm slide" }
        guard let until = dnd.until else { return "On until you turn it off" }
        return "On until \(Date(timeIntervalSince1970: until / 1000).formatted(date: .omitted, time: .shortened))"
    }
}
