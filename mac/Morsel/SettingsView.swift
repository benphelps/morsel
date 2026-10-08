import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettings()
                .tabItem { Label("General", systemImage: "gearshape") }
            NowPlayingSettings()
                .tabItem { Label("Now Playing", systemImage: "music.note") }
            NotificationSettings()
                .tabItem { Label("Notifications", systemImage: "bell.badge") }
            CalendarSettings()
                .tabItem { Label("Calendar", systemImage: "calendar") }
        }
        .frame(width: 500)
    }
}

private struct GeneralSettings: View {
    @Environment(AppState.self) private var state
    @State private var address = ""

    var body: some View {
        @Bindable var state = state
        Form {
            Section {
                LabeledContent("Server") {
                    HStack {
                        TextField("Server", text: $address, prompt: Text("http://localhost:8000"))
                            .labelsHidden()
                            .onSubmit { state.serverAddress = address }
                        Button("Connect") { state.serverAddress = address }
                    }
                }
                LabeledContent("Status") {
                    if !state.serverReachable {
                        Label("Can't reach the server", systemImage: "xmark.circle.fill").foregroundStyle(.red)
                    } else if state.device?.connected == true {
                        Label("Tidbyt connected", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    } else {
                        Label("Server up, Tidbyt offline", systemImage: "exclamationmark.circle.fill").foregroundStyle(.orange)
                    }
                }
            } footer: {
                Text("The address of your morsel server, e.g. http://localhost:8000 when it runs on this Mac.")
            }
            Section {
                Toggle("Open at login", isOn: $state.launchAtLogin)
            }
        }
        .formStyle(.grouped)
        .onAppear { address = state.serverAddress }
    }
}

private struct NowPlayingSettings: View {
    @Environment(AppState.self) private var state

    var body: some View {
        @Bindable var state = state
        Form {
            Section {
                Toggle("Show new songs from Music", isOn: $state.nowPlayingEnabled)
            } footer: {
                Text("When a new track starts in the Music app on this Mac, its artwork, title and artist appear on the Tidbyt for a few seconds. The first time, macOS asks whether morsel may control Music; that's how it reads the artwork.")
            }
            Section {
                Button("Send the current track") { state.sendCurrentTrack() }
            }
        }
        .formStyle(.grouped)
    }
}

private struct NotificationSettings: View {
    @Environment(AppState.self) private var state

    var body: some View {
        @Bindable var state = state
        Form {
            Section {
                Toggle("Forward notifications", isOn: $state.forwardingEnabled)
                statusRow
            } footer: {
                Text("macOS has no public way for apps to read other apps' notifications, so morsel reads Notification Center's database. That needs Full Disk Access. Nothing leaves your network: notifications go only to your morsel server.")
            }

            if state.forwarderStatus == .running || !state.knownApps.isEmpty {
                Section("Apps to forward") {
                    if state.knownApps.isEmpty {
                        Text("No apps have posted notifications yet.").foregroundStyle(.secondary)
                    }
                    ForEach(state.knownApps) { app in
                        Toggle(isOn: Binding(
                            get: { state.forwardedApps.contains(app.id) },
                            set: { on in
                                if on { state.forwardedApps.insert(app.id) } else { state.forwardedApps.remove(app.id) }
                            }
                        )) {
                            HStack(spacing: 8) {
                                if let icon = AppState.appIcon(bundleID: app.id) {
                                    Image(nsImage: icon).resizable().frame(width: 20, height: 20)
                                }
                                Text(app.name)
                            }
                        }
                    }
                }
                Section {
                    Button("Send a test notification") { state.sendTestNotification() }
                }
                Section {
                    if state.seen.isEmpty {
                        Text("Nothing yet. Notifications appear here as they arrive, whether or not they're forwarded.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(state.seen) { item in
                        HStack(spacing: 8) {
                            if let icon = AppState.appIcon(bundleID: item.appID) {
                                Image(nsImage: icon).resizable().frame(width: 18, height: 18)
                            }
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.title.isEmpty ? item.appName : "\(item.appName): \(item.title)").lineLimit(1)
                                Text(item.outcome.rawValue)
                                    .font(.caption)
                                    .foregroundStyle(item.outcome == .forwarded ? .green : item.outcome == .unreadable ? .red : .secondary)
                            }
                            Spacer()
                            if item.outcome == .notInList {
                                Button("Forward this app") { state.forwardedApps.insert(item.appID) }
                                    .controlSize(.small)
                            }
                            Text(item.date, style: .time).font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                } header: {
                    Text("Recently seen")
                } footer: {
                    Text("Outcomes (app and result only, no message text) are also logged to ~/Library/Logs/morsel/forwarder.log.")
                }
            }
        }
        .formStyle(.grouped)
        .onAppear { state.refreshKnownApps() }
    }

    @ViewBuilder
    private var statusRow: some View {
        switch state.forwarderStatus {
        case .off:
            EmptyView()
        case .running:
            Label("Watching for notifications", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        case .needsAccess:
            VStack(alignment: .leading, spacing: 8) {
                Label("Full Disk Access needed", systemImage: "lock.fill").foregroundStyle(.orange)
                Text("macOS doesn't let apps ask for this directly. Grant Access opens the right page in System Settings with a helper you drag into the list; forwarding starts by itself once it's on.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Grant Access…") { state.requestFullDiskAccess() }
                        .buttonStyle(.borderedProminent)
                    Button("Check Again") { state.retryForwarding() }
                }
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 6) {
                Label("Couldn't read notifications", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                Text(message).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                Button("Try Again") { state.retryForwarding() }
            }
        }
    }
}

private struct CalendarSettings: View {
    @Environment(AppState.self) private var state

    var body: some View {
        @Bindable var state = state
        Form {
            Section {
                Toggle("Send today's events to morsel", isOn: $state.calendarEnabled)
                if state.calendarEnabled, state.calendarNeedsAccess {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Calendar access needed", systemImage: "lock.fill").foregroundStyle(.orange)
                        Text("Turn on morsel under Privacy & Security → Calendars (Full Access), then check again.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        HStack {
                            Button("Open Privacy & Security") {
                                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")!)
                            }
                            Button("Check Again") { Task { await state.updateCalendar() } }
                        }
                    }
                } else if let today = state.calendarToday, state.calendarEnabled {
                    LabeledContent("Today", value: today.next.map { "\(today.count) left · next \($0.time) \($0.title)" } ?? "Nothing left today")
                }
            } footer: {
                Text("Today's remaining events appear in morsel as the \u{201C}calendar\u{201D} data source, refreshed when your calendars change and every minute. In the Deck tab, set a slide's \u{201C}Only when\u{201D} to {{calendar.hasEvents}} to show it only on days with events.")
            }

            if state.calendarEnabled, !state.calendarNeedsAccess, !state.calendars.isEmpty {
                Section {
                    ForEach(state.calendars) { cal in
                        Toggle(isOn: Binding(
                            get: { state.calendarIDs.isEmpty || state.calendarIDs.contains(cal.id) },
                            set: { on in
                                // Empty means "all": materialise the full set before removing one.
                                var ids = state.calendarIDs.isEmpty ? Set(state.calendars.map(\.id)) : state.calendarIDs
                                if on { ids.insert(cal.id) } else { ids.remove(cal.id) }
                                state.calendarIDs = ids.count == state.calendars.count ? [] : ids
                            }
                        )) {
                            HStack(spacing: 8) {
                                Circle().fill(Color(nsColor: cal.color)).frame(width: 10, height: 10)
                                Text(cal.title)
                                Text(cal.account).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Calendars")
                }
            }
        }
        .formStyle(.grouped)
    }
}
