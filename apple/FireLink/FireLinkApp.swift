import SwiftUI

@main struct FireLinkApp: App {
  @StateObject private var model = AppModel()
  var body: some Scene {
    #if os(macOS)
      Window("FireLink", id: "main") {
        rootContent.frame(minWidth: 700, minHeight: 520).formStyle(.grouped)
      }
      .defaultSize(width: 1100, height: 760)
    #else
      WindowGroup {
        rootContent
      }
    #endif
  }
  private var rootContent: some View {
    RootView().environmentObject(model).tint(Color(red: 0.77, green: 0.24, blue: 0.14))
  }
}

enum AppSection: String, CaseIterable, Identifiable {
  case home, incidents, account
  var id: Self { self }
  var title: String { L10n.text(rawValue) }
  var symbol: String {
    switch self {
    case .home: "house"
    case .incidents: "map"
    case .account: "person.crop.circle"
    }
  }
}

struct RootView: View {
  @EnvironmentObject var model: AppModel
  @State private var navigation = AppNavigation()

  var body: some View {
    AppNavigationView(navigation: navigation)
      .modifier(TaskPresentation(state: navigation.taskDetail))
      .id(model.demoSessionID ?? "volunteer")
      .onChange(of: model.demoSessionID) { _, _ in navigation = AppNavigation() }
      .onChange(of: navigation.section) { _, value in
        if value == .account && model.profile == nil { model.showLogin = true }
      }
      .sheet(isPresented: $model.showLogin, onDismiss: { model.afterLogin = nil }) {
        NavigationStack { LoginView() }.volunteerSheet()
      }
      .alert(
        L10n.text("notice"),
        isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })
      ) {
        Button(L10n.text("ok")) { model.error = nil }
      } message: {
        Text(model.error ?? "")
      }
      .task { await model.load() }
  }

}
