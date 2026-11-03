import Observation
import SwiftUI

struct TaskSheet: Identifiable {
  enum Kind { case application, contacts }
  let kind: Kind
  let task: RescueTask
  var id: String { "\(kind)-\(task.id)" }
}

@MainActor @Observable final class TaskDetailState {
  private(set) var task: RescueTask?
  private(set) var requestedID: String?
  private(set) var failure: String?
  var sheet: TaskSheet?

  func load(_ id: String, using model: AppModel) async {
    if task?.id == id { return }
    requestedID = id
    task = nil
    failure = nil
    do {
      let result: RescueTask = try await model.request("/v1/tasks/\(id)")
      guard !Task.isCancelled, requestedID == id else { return }
      task = result
    } catch {
      guard !Task.isCancelled, requestedID == id else { return }
      failure = error.localizedDescription
    }
  }
}

/// Used by application history; the browser owns the same state above its layout branches.
struct TaskDetailView: View {
  let id: String
  @EnvironmentObject var model: AppModel
  @State private var state = TaskDetailState()

  var body: some View {
    TaskDetailContent(id: id, state: state)
      .task(id: id) { await state.load(id, using: model) }
      .modifier(TaskPresentation(state: state))
  }
}

struct TaskPresentation: ViewModifier {
  @EnvironmentObject var model: AppModel
  @Bindable var state: TaskDetailState

  func body(content: Content) -> some View {
    content.sheet(item: $state.sheet) { sheet in
      NavigationStack {
        switch sheet.kind {
        case .contacts:
          OrganizerContactsView(organizer: sheet.task.organizer)
        case .application:
          if model.applications.contains(where: { $0.taskId == sheet.task.id }) {
            ApplicationHistoryView()
          } else {
            ApplyView(task: sheet.task)
          }
        }
      }
      .volunteerSheet()
    }
  }
}

struct TaskDetailContent: View {
  let id: String
  @Bindable var state: TaskDetailState
  @EnvironmentObject var model: AppModel

  var body: some View {
    Group {
      if let task = state.task, task.id == id {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            TaskHeading(task: task)
            Divider()
            ContentBlocks(blocks: task.blocks)
          }
          .padding(24).readableContent()
        }
        .accessibilityIdentifier("task-detail-" + id)
        .safeAreaInset(edge: .bottom) {
          #if !os(macOS)
            TaskActions(task: task, state: state)
              .frame(maxWidth: .infinity, alignment: .trailing)
              .padding().readableContent().background(.bar)
          #endif
        }
        .toolbar {
          #if os(macOS)
            ToolbarItemGroup(placement: .primaryAction) {
              TaskContactButton(task: task, state: state)
                .labelStyle(.iconOnly)
                .help(L10n.text("contact_organizer"))
              TaskApplyButton(task: task, state: state)
            }
          #endif
        }
        .navigationTitle(task.title)
      } else if state.requestedID == id, let failure = state.failure {
        ContentUnavailableView {
          Label(L10n.text("load_failed"), systemImage: "wifi.exclamationmark")
        } description: {
          Text(failure)
        } actions: {
          Button(L10n.text("retry")) { Task { await state.load(id, using: model) } }
        }
      } else {
        ProgressView()
      }
    }
    .inlineNavigationTitle()
  }
}

private struct TaskHeading: View {
  let task: RescueTask

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(task.title).font(.largeTitle.bold())
      Text(task.summary).foregroundStyle(.secondary)
      HStack(spacing: 10) {
        Image(systemName: task.organizer.verified ? "checkmark.seal.fill" : "building.2")
          .foregroundStyle(.teal)
        VStack(alignment: .leading, spacing: 4) {
          Text(task.organizer.name).font(.headline)
          Text(L10n.text(task.organizer.verified ? "verified_organizer" : "unverified"))
            .font(.caption).foregroundStyle(.secondary)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct TaskActions: View {
  let task: RescueTask
  let state: TaskDetailState

  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 16) {
        TaskContactButton(task: task, state: state)
        TaskApplyButton(task: task, state: state)
      }
      VStack(alignment: .trailing, spacing: 12) {
        TaskApplyButton(task: task, state: state)
        TaskContactButton(task: task, state: state)
      }
    }
  }
}

private struct TaskContactButton: View {
  let task: RescueTask
  let state: TaskDetailState
  var body: some View {
    if !task.organizer.contacts.isEmpty {
      Button {
        state.sheet = TaskSheet(kind: .contacts, task: task)
      } label: {
        Label(L10n.text("contact_organizer"), systemImage: "bubble.left")
      }
    }
  }
}

private struct TaskApplyButton: View {
  @EnvironmentObject var model: AppModel
  let task: RescueTask
  let state: TaskDetailState

  var body: some View {
    let applied = model.applications.contains(where: { $0.taskId == task.id })
    Button(L10n.text(applied ? "applied_view_history" : "apply")) {
      model.authenticated { state.sheet = TaskSheet(kind: .application, task: task) }
    }
    .buttonStyle(.borderedProminent)
    .disabled(!applied && task.status != "open")
  }
}
