import SwiftUI

@main struct FireLinkApp: App {
  @StateObject private var model = AppModel()
  init() {
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("--demo-ui-test") {
        TokenStore.save(nil)
        UserDefaults.standard.set(AppModel.defaultServer, forKey: "serverURL")
      } else if ProcessInfo.processInfo.arguments.contains("--ui-test") {
        TokenStore.save(nil)
        UserDefaults.standard.set("http://localhost:8787", forKey: "serverURL")
      }
    #endif
  }
  var body: some Scene {
    WindowGroup {
      RootView().environmentObject(model).tint(Color(red: 0.77, green: 0.24, blue: 0.14))
    }
  }
}
struct RootView: View {
  @EnvironmentObject var model: AppModel
  @State private var selected = 0
  var body: some View {
    TabView(selection: $selected) {
      NavigationStack { HomeView() }.tabItem { Label(L10n.text("home"), systemImage: "house") }.tag(
        0)
      NavigationStack { IncidentsView() }.tabItem {
        Label(L10n.text("incidents"), systemImage: "map")
      }.tag(1)
      NavigationStack { AccountView() }.tabItem {
        Label(L10n.text("account"), systemImage: "person.crop.circle")
      }
      .tag(2)
    }
    .id(model.demoSessionID)
    .onChange(of: model.demoSessionID) { _, _ in selected = 0 }
    .onChange(of: selected) { _, value in
      if value == 2 && model.profile == nil { model.showLogin = true }
    }
    .sheet(isPresented: $model.showLogin, onDismiss: { model.afterLogin = nil }) {
      NavigationStack { LoginView() }
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
