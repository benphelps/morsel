import AppKit
import SwiftUI

/// macOS has no API to request Full Disk Access, so this does what well-behaved apps do:
/// opens the right Settings pane, floats a helper with our icon to drag into the list,
/// and watches for access to arrive.
final class FullDiskAccessGuide {
    var isGranted: () -> Bool = { false }
    var onGranted: (() -> Void)?

    private var panel: NSPanel?
    private var timer: Timer?

    func begin() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!)
        showPanel()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.check() }
        }
    }

    func cancel() {
        timer?.invalidate()
        timer = nil
        panel?.close()
        panel = nil
    }

    private func check() {
        guard isGranted() else { return }
        cancel()
        onGranted?()
    }

    private func showPanel() {
        if panel == nil {
            let panel = NSPanel(
                contentRect: NSRect(x: 0, y: 0, width: 300, height: 220),
                styleMask: [.titled, .closable, .nonactivatingPanel, .utilityWindow],
                backing: .buffered, defer: false
            )
            panel.title = "Full Disk Access"
            panel.level = .floating
            panel.isFloatingPanel = true
            panel.hidesOnDeactivate = false
            panel.isReleasedWhenClosed = false
            panel.contentView = NSHostingView(rootView: FullDiskAccessGuideView(
                onCancel: { [weak self] in self?.cancel() },
                onRelaunch: Self.relaunch
            ))
            self.panel = panel
        }
        // Bottom right, clear of System Settings, which usually opens centred.
        if let panel, let screen = NSScreen.main {
            let frame = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: frame.maxX - panel.frame.width - 24, y: frame.minY + 24))
            panel.orderFrontRegardless()
        }
    }

    /// Some macOS versions only honour a new grant after the app restarts.
    static func relaunch() {
        let path = Bundle.main.bundleURL.path
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "sleep 1; /usr/bin/open \"$0\"", path]
        try? task.run()
        NSApp.terminate(nil)
    }
}

private struct FullDiskAccessGuideView: View {
    let onCancel: () -> Void
    let onRelaunch: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("Drag morsel into the list")
                .font(.headline)
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 64, height: 64)
                .onDrag { NSItemProvider(object: Bundle.main.bundleURL as NSURL) }
                .help("Drag into the Full Disk Access list")
            Text("Or click + under the list and choose morsel from the Applications folder in your home folder. This closes by itself once access is on.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Cancel", action: onCancel)
                Spacer()
                Button("Relaunch morsel", action: onRelaunch)
                    .help("If access is on but this window hasn't closed, macOS may need morsel to restart.")
            }
            .controlSize(.small)
        }
        .padding(16)
        .frame(width: 300)
    }
}
