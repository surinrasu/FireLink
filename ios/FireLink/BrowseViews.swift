import AVKit
import MapKit
import SwiftUI

struct HomeView: View {
  @EnvironmentObject var model: AppModel
  @State private var showNotifications = false
  @State private var showApplications = false
  @State private var openingNotice = false
  @AppStorage("nearbyEnabled") var nearbyEnabled = true
  var unread: [Notice] { Array(model.notifications.filter { $0.readAt == nil }.prefix(2)) }
  var nearby: Incident? {
    guard nearbyEnabled, let region = model.profile?.region, !region.isEmpty else { return nil }
    return model.incidents.first { incident in
      incident.region.split(separator: " ").contains { $0.count >= 2 && region.contains($0) }
    }
  }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        if !unread.isEmpty {
          VStack(spacing: 0) {
            ForEach(unread) { notice in
              if notice.id != unread.first?.id { Divider().padding(.horizontal, 14) }
              Button {
                openingNotice = true
                Task {
                  defer { openingNotice = false }
                  do {
                    try await model.markNotificationRead(notice.id)
                    if notice.applicationId != nil {
                      showApplications = true
                    } else {
                      showNotifications = true
                    }
                  } catch { model.error = error.localizedDescription }
                }
              } label: {
                HStack(spacing: 8) {
                  Image(systemName: "bell.badge").foregroundStyle(.tint)
                  (Text(notice.title).bold() + Text("  " + notice.body).foregroundColor(.secondary))
                    .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                  Image(systemName: "chevron.right").foregroundStyle(.secondary)
                }.font(.subheadline).padding(.horizontal, 14).padding(.vertical, 12)
                  .frame(minHeight: 44)
              }
              .buttonStyle(.plain).disabled(openingNotice)
              .accessibilityLabel(L10n.text("unread_notice", notice.title, notice.body))
              .accessibilityIdentifier("unread-notice-" + notice.id)
            }
          }.background(.tint.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
        }
        if let incident = nearby ?? model.incidents.first {
          Text(nearby == nil ? L10n.text("recruiting") : L10n.text("nearby_opportunities")).font(
            .title2.bold())
          NavigationLink {
            IncidentView(incident: incident)
          } label: {
            IncidentCard(incident: incident)
          }.buttonStyle(.plain).accessibilityIdentifier("incident-" + incident.id)
        }
        Text(L10n.text("guides")).font(.title2.bold())
        ForEach(model.articles) { article in
          NavigationLink {
            ScrollView { ContentBlocks(blocks: article.blocks).padding() }.navigationTitle(
              article.title
            ).navigationBarTitleDisplayMode(.inline)
          } label: {
            HStack(alignment: .top, spacing: 16) {
              Image(systemName: "book.closed").font(.title2).foregroundStyle(.tint).frame(
                width: 48, height: 60
              ).background(.tint.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
              VStack(alignment: .leading, spacing: 6) {
                Text(L10n.text("article_read_time", article.category, article.minutes)).font(
                  .caption
                ).foregroundStyle(
                  .secondary)
                Text(article.title).font(.headline)
                Text(article.summary).font(.subheadline).foregroundStyle(.secondary)
              }
              Spacer()
            }.padding(.vertical, 6)
          }.buttonStyle(.plain)
        }
        if model.incidents.isEmpty && !model.loading {
          ContentUnavailableView(
            L10n.text("no_content"), systemImage: "wifi",
            description: Text(L10n.text("refresh_later")))
        }
      }.padding(20)
    }.navigationTitle("FireLink").refreshable { await model.load() }
      .navigationDestination(isPresented: $showNotifications) { NotificationHistoryView() }
      .navigationDestination(isPresented: $showApplications) { ApplicationHistoryView() }
      .overlay { if model.loading && model.incidents.isEmpty { ProgressView() } }
  }
}
struct MapPreview: View {
  let latitude: Double
  let longitude: Double
  var height: CGFloat = 150
  var body: some View {
    let point = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    Map(
      initialPosition: .region(
        MKCoordinateRegion(
          center: point, span: MKCoordinateSpan(latitudeDelta: 0.035, longitudeDelta: 0.035)))
    ) { Marker(L10n.text("location"), coordinate: point).tint(.orange) }
    .mapStyle(.standard(elevation: .flat)).frame(height: height).allowsHitTesting(false)
    .accessibilityLabel(L10n.text("coordinates", latitude, longitude))
  }
}
struct AnnotatedMapPreview: View {
  let annotations: [MapAnnotation]
  var body: some View {
    Map(initialPosition: .automatic, interactionModes: []) {
      ForEach(Array(annotations.enumerated()), id: \.offset) { _, annotation in
        let coordinates = annotation.coordinates.map {
          CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
        }
        if annotation.type == "area" && coordinates.count >= 3 {
          MapPolygon(coordinates: coordinates)
            .foregroundStyle(Color.accentColor.opacity(0.18))
            .stroke(Color.accentColor, lineWidth: 3)
        } else if annotation.type == "path" && coordinates.count >= 2 {
          MapPolyline(coordinates: coordinates).stroke(Color.accentColor, lineWidth: 3)
        }
        ForEach(Array(coordinates.enumerated()), id: \.offset) { index, coordinate in
          if annotation.type == "point" {
            Marker(L10n.text("location"), coordinate: coordinate).tint(Color.accentColor)
          } else {
            Annotation("\(index + 1)", coordinate: coordinate) {
              Circle().fill(Color.accentColor).frame(width: 8, height: 8)
                .overlay(Circle().stroke(.white, lineWidth: 2))
            }
          }
        }
      }
    }
    .mapStyle(.standard(elevation: .flat)).frame(height: 220).allowsHitTesting(false)
    .accessibilityLabel(L10n.text("location"))
  }
}
struct IncidentCard: View {
  let incident: Incident
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      MapPreview(latitude: incident.latitude, longitude: incident.longitude)
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          Label(L10n.text("volunteer_opportunities"), systemImage: "flame").foregroundStyle(.tint)
          Spacer()
        }.font(.caption.bold())
        Text(incident.title).font(.headline)
        Text(incident.region).font(.caption).foregroundStyle(.secondary)
        ForEach(incident.tasks.prefix(3)) { task in
          HStack {
            Circle().fill(.tint).frame(width: 5, height: 5)
            Text(task.title).font(.subheadline)
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
          }
        }
        Text(L10n.text("updated_at", displayDate(incident.updatedAt))).font(.caption2)
          .foregroundStyle(.secondary)
      }.padding(16)
    }.background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
      .clipShape(RoundedRectangle(cornerRadius: 20))
  }
}
func displayDate(_ value: String) -> String {
  let parser = ISO8601DateFormatter()
  parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  guard let date = parser.date(from: value) ?? ISO8601DateFormatter().date(from: value) else {
    return String(value.prefix(16)).replacingOccurrences(of: "T", with: " ")
  }
  let formatter = DateFormatter()
  formatter.locale = .autoupdatingCurrent
  formatter.timeZone = .autoupdatingCurrent
  formatter.dateStyle = .medium
  formatter.timeStyle = .short
  return formatter.string(from: date)
}
struct IncidentsView: View {
  @EnvironmentObject var model: AppModel
  @State private var sort: IncidentSort = .updated
  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 20) {
        Menu {
          Picker(L10n.text("sort_by"), selection: $sort) {
            ForEach(IncidentSort.allCases) { option in Text(option.label).tag(option) }
          }
        } label: {
          Label(sort.label, systemImage: "arrow.up.arrow.down")
        }.accessibilityIdentifier("incident-sort")
        ForEach(sort.apply(model.incidents)) { incident in
          NavigationLink {
            IncidentView(incident: incident)
          } label: {
            IncidentCard(incident: incident)
          }.buttonStyle(.plain).accessibilityIdentifier("incident-" + incident.id)
        }
        if model.incidents.isEmpty {
          ContentUnavailableView(
            L10n.text("no_incidents"), systemImage: "checkmark.shield",
            description: Text(L10n.text("no_incidents_hint")))
        }
      }.padding()
    }.background(Color(.systemGroupedBackground)).navigationTitle(L10n.text("incidents"))
      .refreshable {
        await model.load()
      }
  }
}
struct IncidentView: View {
  let incident: Incident
  var body: some View {
    List {
      Section {
        MapPreview(latitude: incident.latitude, longitude: incident.longitude).listRowInsets(
          EdgeInsets())
        Text(incident.region)
      }
      Section(L10n.text("tasks")) {
        ForEach(incident.tasks) { task in
          NavigationLink {
            TaskDetailView(id: task.id)
          } label: {
            VStack(alignment: .leading, spacing: 8) {
              Text(task.title).font(.headline)
              Text(task.summary).font(.subheadline).foregroundStyle(.secondary)
              Text(
                task.status == "open" ? L10n.text("accepting_applications") : L10n.text("closed")
              ).font(.caption).foregroundStyle(.tint)
            }.padding(.vertical, 8)
          }.accessibilityIdentifier("task-" + task.id)
        }
      }
    }.navigationTitle(incident.title).navigationBarTitleDisplayMode(.inline)
  }
}
struct TaskDetailView: View {
  let id: String
  @EnvironmentObject var model: AppModel
  @State var task: RescueTask?
  @State var applying = false
  @State var showContacts = false
  @State var loadError: String?
  var body: some View {
    Group {
      if let task {
        ScrollView {
          VStack(alignment: .leading, spacing: 22) {
            HStack {
              Image(systemName: task.organizer.verified ? "checkmark.seal.fill" : "building.2")
                .foregroundStyle(.teal)
              VStack(alignment: .leading, spacing: 4) {
                Text(task.organizer.name).font(.headline)
                Text(
                  task.organizer.verified
                    ? L10n.text("verified_organizer") : L10n.text("unverified")
                ).font(.caption)
                  .foregroundStyle(.secondary)
              }
            }
            Divider()
            Text(task.title).font(.largeTitle.bold())
            Text(task.summary).foregroundStyle(.secondary)
            ContentBlocks(blocks: task.blocks)
          }.padding(20)
        }
        .safeAreaInset(edge: .bottom) {
          HStack {
            if !task.organizer.contacts.isEmpty {
              Button {
                showContacts = true
              } label: {
                Label(L10n.text("contact_organizer"), systemImage: "bubble.left").font(.subheadline)
              }
            }
            Spacer()
            Button(
              model.applications.contains(where: { $0.taskId == id })
                ? L10n.text("applied_view_history") : L10n.text("apply")
            ) {
              model.authenticated { applying = true }
            }.buttonStyle(.borderedProminent).disabled(task.status != "open")
          }.padding().background(.bar)
        }
        .sheet(isPresented: $showContacts) {
          NavigationStack { OrganizerContactsView(organizer: task.organizer) }
        }
        .sheet(isPresented: $applying) {
          NavigationStack {
            if model.applications.contains(where: { $0.taskId == id }) {
              ApplicationHistoryView()
            } else {
              ApplyView(task: task)
            }
          }
        }
      } else if let loadError {
        ContentUnavailableView {
          Label(L10n.text("load_failed"), systemImage: "wifi.exclamationmark")
        } description: {
          Text(loadError)
        } actions: {
          Button(L10n.text("retry")) { Task { await load() } }
        }
      } else {
        ProgressView()
      }
    }.navigationBarTitleDisplayMode(.inline).task { await load() }
  }
  func load() async {
    loadError = nil
    do { task = try await model.request("/v1/tasks/\(id)") } catch {
      loadError = error.localizedDescription
    }
  }
}
struct ContentBlocks: View {
  let blocks: [ContentBlock]
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
        switch block.type {
        case "heading": Text(block.text ?? "").font(.title2.bold())
        case "image":
          if let url = URL(string: block.url ?? "") {
            AsyncImage(url: url) { image in
              image.resizable().scaledToFit()
            } placeholder: {
              ProgressView()
            }
            if let text = block.text { Text(text).font(.caption).foregroundStyle(.secondary) }
          }
        case "video":
          if let url = URL(string: block.url ?? "") {
            VideoPlayer(player: AVPlayer(url: url)).frame(height: 220)
          }
        case "map":
          if let annotations = block.annotations {
            if !annotations.isEmpty {
              AnnotatedMapPreview(annotations: annotations).clipShape(
                RoundedRectangle(cornerRadius: 12))
              Text(block.text ?? L10n.text("location")).font(.caption)
            }
          } else if let latitude = block.latitude, let longitude = block.longitude {
            MapPreview(latitude: latitude, longitude: longitude, height: 200).clipShape(
              RoundedRectangle(cornerRadius: 12))
            Text(block.text ?? L10n.text("location")).font(.caption)
          }
        case "table":
          ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 12) {
              ForEach(Array((block.rows ?? []).enumerated()), id: \.offset) { rowIndex, row in
                GridRow {
                  ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                    Text(cell).font(rowIndex == 0 ? .headline : .body)
                  }
                }
              }
            }.padding().background(
              Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
          }
        default: Text(block.text ?? "").lineSpacing(6).textSelection(.enabled)
        }
      }
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}
struct ApplyView: View {
  let task: RescueTask
  @EnvironmentObject var model: AppModel
  @Environment(\.dismiss) var dismiss
  @State var fields: Set<String> = []
  @State var contacts: Set<String> = []
  @State var consent = false
  @State var busy = false
  @State var failure: String?
  var body: some View {
    Form {
      Section {
        Text(task.title).font(.headline)
        Text(L10n.text("shared_with", task.organizer.name)).font(.subheadline)
      }
      Section(L10n.text("profile_shared_now")) {
        ForEach(
          [
            "username", "pronouns", "realName", "age", "gender", "region", "body", "vehicles",
            "equipment",
            "skills",
          ], id: \.self
        ) { field in
          Toggle(
            (fieldLabels[field] ?? field)
              + (task.requiredFields.contains(field) ? L10n.text("required_suffix") : ""),
            isOn: selection(field, in: $fields)
          ).disabled(task.requiredFields.contains(field))
        }
      }
      Section {
        ForEach(["phone", "wechat", "email"], id: \.self) { field in
          Toggle(
            (fieldLabels[field] ?? field)
              + (task.contactFields.contains(field) ? L10n.text("required_suffix") : ""),
            isOn: selection(field, in: $contacts)
          ).disabled(task.contactFields.contains(field))
        }
      } header: {
        Text(L10n.text("contacts_shared_on_acceptance"))
      } footer: {
        Text(L10n.text("contact_consent_hint"))
      }
      Section { Toggle(L10n.text("confirm_consent"), isOn: $consent) }
      if let failure { Section { Text(failure).foregroundStyle(.red) } }
      Section {
        Button(busy ? L10n.text("submitting") : L10n.text("confirm_application")) {
          Task { await submit() }
        }.disabled(!consent || busy)
      }
    }.navigationTitle(L10n.text("application_consent")).toolbar {
      ToolbarItem(placement: .cancellationAction) { Button(L10n.text("cancel")) { dismiss() } }
    }
    .onAppear {
      fields = Set(task.requiredFields)
      contacts = Set(task.contactFields)
    }
  }
  func selection(_ key: String, in binding: Binding<Set<String>>) -> Binding<Bool> {
    Binding(
      get: { binding.wrappedValue.contains(key) },
      set: { if $0 { binding.wrappedValue.insert(key) } else { binding.wrappedValue.remove(key) } })
  }
  func submit() async {
    busy = true
    defer { busy = false }
    do {
      let _: CreatedApplication = try await model.request(
        "/v1/applications", method: "POST",
        body: [
          "taskId": task.id, "fields": Array(fields), "contactFields": Array(contacts),
          "consentVersion": 1,
        ])
      try await model.refreshPrivate()
      dismiss()
    } catch { failure = error.localizedDescription }
  }
}
