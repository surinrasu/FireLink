import Observation
import SwiftUI

/// Each window owns its navigation. Resizing changes presentation, never the route.
@MainActor @Observable final class AppNavigation {
  var section: AppSection = .home {
    didSet { browse.isActive = section == .incidents }
  }
  var homePath = NavigationPath()
  var accountPath = NavigationPath()
  var browse = BrowseNavigation()
  var taskDetail = TaskDetailState()

  func openIncident(_ id: String) {
    browse.selection = .incident(id)
    section = .incidents
  }
}

enum BrowseDestination: Hashable {
  case incident(String)
  case task(id: String, incidentID: String)

  var taskID: String? {
    if case .task(let id, _) = self { return id }
    return nil
  }
}

@MainActor @Observable final class BrowseNavigation {
  var path: [BrowseDestination] = []
  var sort: IncidentSort = .updated
  var isActive = false

  func updatePresentedPath(_ path: [BrowseDestination]) {
    // Native containers can write an empty path as an inactive tab is dismantled.
    guard isActive else { return }
    self.path = path
  }

  func selectPresentedRow(_ destination: BrowseDestination?) {
    // Removing a List during a layout transition isn't a request to leave the task.
    guard isActive, let destination else { return }
    selection = destination
  }

  /// The same route backs List selection on wide windows and the compact stack.
  var selection: BrowseDestination? {
    get { path.last }
    set {
      switch newValue {
      case .incident(let id): path = [.incident(id)]
      case .task(let id, let incidentID):
        path = [.incident(incidentID), .task(id: id, incidentID: incidentID)]
      case nil: path = []
      }
    }
  }
}

struct AppNavigationView: View {
  @Bindable var navigation: AppNavigation

  var body: some View {
    if #available(iOS 18, macOS 15, visionOS 2, *) {
      TabView(selection: $navigation.section) {
        ForEach(AppSection.allCases) { section in
          Tab(section.title, systemImage: section.symbol, value: section) {
            AppSectionView(section: section, navigation: navigation)
          }
          .accessibilityIdentifier("section-" + section.rawValue)
        }
      }
      .tabViewStyle(.sidebarAdaptable)
    } else {
      LegacyAppNavigation(navigation: navigation)
    }
  }
}

private struct LegacyAppNavigation: View {
  @Bindable var navigation: AppNavigation

  var body: some View {
    #if os(macOS)
      NavigationSplitView {
        List(
          selection: Binding<AppSection?>(
            get: { navigation.section },
            set: { if let section = $0 { navigation.section = section } }
          )
        ) {
          ForEach(AppSection.allCases) { section in
            Label(section.title, systemImage: section.symbol)
              .tag(section)
              .accessibilityIdentifier("section-" + section.rawValue)
          }
        }
        .navigationTitle("FireLink")
        .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 260)
      } detail: {
        AppSectionView(section: navigation.section, navigation: navigation)
      }
    #else
      TabView(selection: $navigation.section) {
        ForEach(AppSection.allCases) { section in
          AppSectionView(section: section, navigation: navigation)
            .tabItem { Label(section.title, systemImage: section.symbol) }
            .tag(section)
        }
      }
    #endif
  }
}

private struct AppSectionView: View {
  let section: AppSection
  @Bindable var navigation: AppNavigation

  var body: some View {
    switch section {
    case .home:
      NavigationStack(path: $navigation.homePath) {
        HomeView(navigation: navigation)
          .toolbar { RefreshToolbar() }
      }
    case .incidents:
      IncidentsWorkspace(navigation: navigation.browse, taskDetail: navigation.taskDetail)
    case .account:
      NavigationStack(path: $navigation.accountPath) {
        AccountView().toolbar { RefreshToolbar() }
      }
    }
  }
}

struct RefreshToolbar: ToolbarContent {
  @EnvironmentObject var model: AppModel

  var body: some ToolbarContent {
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

struct IncidentsWorkspace: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  #endif
  @ScaledMetric(relativeTo: .body) private var minimumSplitWidth = 760
  @Bindable var navigation: BrowseNavigation
  @Bindable var taskDetail: TaskDetailState

  private var supportsColumns: Bool {
    #if os(iOS)
      horizontalSizeClass != .compact && !dynamicTypeSize.isAccessibilitySize
    #else
      !dynamicTypeSize.isAccessibilitySize
    #endif
  }

  var body: some View {
    GeometryReader { geometry in
      if geometry.size.width >= minimumSplitWidth && supportsColumns {
        #if os(macOS)
          // TabView already owns the window's navigation split and toolbar on Mac.
          // A native content split avoids applying that sidebar's insets a second time.
          HSplitView {
            IncidentBrowserList(navigation: navigation, selectsInPlace: true)
              .frame(minWidth: 260, idealWidth: 300, maxWidth: 360)
            selectedDetail.frame(minWidth: 400)
          }
        #else
          NavigationSplitView {
            IncidentBrowserList(navigation: navigation, selectsInPlace: true)
              .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 360)
          } detail: {
            selectedDetail
          }
          .navigationSplitViewStyle(.balanced)
        #endif
      } else {
        CompactIncidentBrowser(navigation: navigation, taskDetail: taskDetail)
      }
    }
    // The task request lives outside the two navigation presentations; sheets are hosted at root.
    .task(id: navigation.selection?.taskID) {
      if let id = navigation.selection?.taskID { await taskDetail.load(id, using: model) }
    }
  }

  private var selectedDetail: some View {
    NavigationStack {
      BrowseDetail(
        destination: navigation.selection, navigation: navigation,
        taskDetail: taskDetail, selectsInPlace: true)
    }
  }
}

private struct CompactIncidentBrowser: View {
  let navigation: BrowseNavigation
  let taskDetail: TaskDetailState
  @State private var presentedPath: [BrowseDestination] = []
  @State private var isPresented = false

  var body: some View {
    NavigationStack(path: $presentedPath) {
      IncidentBrowserList(navigation: navigation, selectsInPlace: false)
        .navigationDestination(for: BrowseDestination.self) { destination in
          BrowseDetail(
            destination: destination, navigation: navigation,
            taskDetail: taskDetail, selectsInPlace: false)
        }
    }
    .onAppear {
      // A newly mounted native stack may reset its binding before registering destinations.
      // Restore from the scene's route after mounting, then accept user navigation changes.
      presentedPath = navigation.path
      isPresented = true
    }
    .onDisappear { isPresented = false }
    .onChange(of: presentedPath) { _, path in
      if isPresented { navigation.updatePresentedPath(path) }
    }
  }
}

private struct IncidentBrowserList: View {
  @EnvironmentObject var model: AppModel
  @Bindable var navigation: BrowseNavigation
  let selectsInPlace: Bool

  var body: some View {
    List(
      selection: selectsInPlace
        ? Binding(
          get: { navigation.selection }, set: { navigation.selectPresentedRow($0) }
        ) : nil
    ) {
      ForEach(navigation.sort.apply(model.incidents)) { incident in
        Section {
          destinationRow(.incident(incident.id)) {
            VStack(alignment: .leading, spacing: 6) {
              Text(incident.title).font(.headline)
              Text(incident.region).font(.subheadline).foregroundStyle(.secondary)
            }
            .padding(.vertical, 6)
          }
          .accessibilityIdentifier("incident-" + incident.id)
          ForEach(incident.tasks) { task in
            destinationRow(.task(id: task.id, incidentID: incident.id)) {
              TaskSummaryRow(task: task, showsSummary: false)
            }
            .accessibilityIdentifier("task-" + task.id)
          }
        }
      }
    }
    .navigationTitle(L10n.text("incidents"))
    .toolbar {
      ToolbarItem {
        Menu {
          Picker(L10n.text("sort_by"), selection: $navigation.sort) {
            ForEach(IncidentSort.allCases) { option in Text(option.label).tag(option) }
          }
        } label: {
          Label(navigation.sort.label, systemImage: "arrow.up.arrow.down")
        }
        .accessibilityIdentifier("incident-sort")
      }
      RefreshToolbar()
    }
    .refreshable { await model.load() }
    .overlay {
      if model.incidents.isEmpty {
        if model.loading {
          ProgressView()
        } else {
          ContentUnavailableView(
            L10n.text("no_incidents"), systemImage: "checkmark.shield",
            description: Text(L10n.text("no_incidents_hint")))
        }
      }
    }
  }

  @ViewBuilder private func destinationRow<Content: View>(
    _ destination: BrowseDestination, @ViewBuilder content: () -> Content
  ) -> some View {
    if selectsInPlace {
      content().tag(destination)
    } else {
      NavigationLink(value: destination, label: content)
    }
  }
}

private struct BrowseDetail: View {
  @EnvironmentObject var model: AppModel
  let destination: BrowseDestination?
  let navigation: BrowseNavigation
  let taskDetail: TaskDetailState
  let selectsInPlace: Bool

  var body: some View {
    switch destination {
    case .incident(let id):
      if let incident = model.incidents.first(where: { $0.id == id }) {
        IncidentView(incident: incident, navigation: navigation, selectsInPlace: selectsInPlace)
      } else {
        ContentUnavailableView(L10n.text("no_incidents"), systemImage: "map")
      }
    case .task(let id, _):
      TaskDetailContent(id: id, state: taskDetail)
    case nil:
      ContentUnavailableView(
        L10n.text("select_opportunity"), systemImage: "list.bullet.rectangle",
        description: Text(L10n.text("select_opportunity_hint")))
    }
  }
}

struct TaskSummaryRow: View {
  let task: TaskSummary
  var showsSummary = true

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(task.title).font(.headline)
      if showsSummary { Text(task.summary).font(.subheadline).foregroundStyle(.secondary) }
      Text(task.status == "open" ? L10n.text("accepting_applications") : L10n.text("closed"))
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .padding(.vertical, 6)
  }
}
