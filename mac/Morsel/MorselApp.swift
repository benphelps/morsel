import SwiftUI

@main
struct MorselApp: App {
    @State private var state = AppState()

    var body: some Scene {
        MenuBarExtra {
            MenuView()
                .environment(state)
        } label: {
            Image(systemName: state.dnd?.enabled == true ? "moon.fill" : state.serverReachable ? "circle.grid.3x3.fill" : "circle.grid.3x3")
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView()
                .environment(state)
        }
    }
}
