import SwiftUI

struct NotificationHistoryView: View {
  @EnvironmentObject var model: AppModel
  @State private var loading = false
  @State private var failed = false
  @State private var opening: String?
  @State private var showApplications = false
  var body: some View {
    Group {
      if model.profile == nil {
        ContentUnavailableView {
          Label(L10n.text("notifications_sign_in"), systemImage: "bell")
        } description: {
          Text(L10n.text("notifications_sign_in_hint"))
        } actions: {
          Button(L10n.text("sign_in_register")) { model.authenticated {} }
        }
      } else {
        List {
          ForEach(model.notifications) { notice in
            Button {
              Task {
                opening = notice.id
                defer { opening = nil }
                do {
                  try await model.markNotificationRead(notice.id)
                  if notice.applicationId != nil { showApplications = true }
                } catch { model.error = error.localizedDescription }
              }
            } label: {
              VStack(alignment: .leading, spacing: 10) {
                HStack {
                  Image(systemName: "bell").foregroundStyle(.tint)
                  Text(notice.title).font(.headline).fontWeight(
                    notice.readAt == nil ? .bold : .medium)
                  Spacer()
                  if notice.readAt == nil {
                    Text(L10n.text("unread")).font(.caption).foregroundStyle(.tint)
                  }
                }
                Text(notice.body).font(.body)
                Text(displayDate(notice.createdAt)).font(.caption).foregroundStyle(.secondary)
                if notice.applicationId != nil {
                  Label(L10n.text("view_applications"), systemImage: "chevron.right").font(.caption)
                    .foregroundStyle(
                      .tint)
                }
              }.padding(.vertical, 8)
            }.buttonStyle(.plain).disabled(opening != nil)
          }
        }
        .overlay {
          if model.notifications.isEmpty {
            if loading {
              ProgressView()
            } else if failed {
              ContentUnavailableView {
                Label(L10n.text("notifications_failed"), systemImage: "wifi.exclamationmark")
              } actions: {
                Button(L10n.text("retry")) { Task { await reload() } }
              }
            } else {
              ContentUnavailableView(
                L10n.text("no_notifications"), systemImage: "bell",
                description: Text(L10n.text("no_notifications_hint")))
            }
          }
        }
        .refreshable { await reload() }
      }
    }
    .navigationTitle(L10n.text("notification_history")).navigationBarTitleDisplayMode(.inline)
    .navigationDestination(isPresented: $showApplications) { ApplicationHistoryView() }
    .task(id: model.profile?.id) { if model.profile != nil { await reload() } }
  }
  func reload() async {
    loading = true
    failed = false
    defer { loading = false }
    do { try await model.refreshNotifications() } catch {
      failed = true
      model.error = error.localizedDescription
    }
  }
}
