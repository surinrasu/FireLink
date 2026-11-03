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

private enum AppSection: String, CaseIterable, Identifiable {
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
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  #endif
  @State private var selected: AppSection = .home

  private var usesSidebar: Bool {
    #if os(iOS)
      horizontalSizeClass == .regular && !dynamicTypeSize.isAccessibilitySize
    #else
      true
    #endif
  }

  var body: some View {
    Group {
      if usesSidebar {
        NavigationSplitView {
          List(
            selection: Binding<AppSection?>(
              get: { selected }, set: { if let section = $0 { selected = section } }
            )
          ) {
            ForEach(AppSection.allCases) { section in
              Label(section.title, systemImage: section.symbol)
                .tag(section)
                .accessibilityIdentifier("section-" + section.rawValue)
            }
          }
          .navigationTitle("FireLink")
          .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 280)
        } detail: {
          NavigationStack { content(for: selected) }
            .id(selected)
            .toolbar {
              ToolbarItem(placement: .primaryAction) {
                Button {
                  Task { await model.load() }
                } label: {
                  Label(L10n.text("refresh"), systemImage: "arrow.clockwise")
                }
                .keyboardShortcut("r", modifiers: .command)
                .disabled(model.loading)
                .accessibilityIdentifier("refresh-content")
              }
            }
        }
        .navigationSplitViewStyle(.balanced)
      } else {
        TabView(selection: $selected) {
          ForEach(AppSection.allCases) { section in
            NavigationStack { content(for: section) }
              .tabItem { Label(section.title, systemImage: section.symbol) }
              .tag(section)
          }
        }
      }
    }
    .id(model.demoSessionID ?? "volunteer")
    .onChange(of: model.demoSessionID) { _, _ in selected = .home }
    .onChange(of: selected) { _, value in
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

  @ViewBuilder private func content(for section: AppSection) -> some View {
    switch section {
    case .home: HomeView()
    case .incidents: IncidentsView()
    case .account: AccountView()
    }
  }
}
