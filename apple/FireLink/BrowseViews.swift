import AVKit
import MapKit
import SwiftUI

struct HomeView: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @ScaledMetric(relativeTo: .body) private var minimumColumnsWidth = 760
  let navigation: AppNavigation
  @State private var showNotifications = false
  @State private var showApplications = false
  @AppStorage("nearbyEnabled") private var nearbyEnabled = true

  private var nearby: Incident? {
    guard nearbyEnabled, let region = model.profile?.region, !region.isEmpty else { return nil }
    return model.incidents.first { incident in
      incident.region.split(separator: " ").contains { $0.count >= 2 && region.contains($0) }
    }
  }

  var body: some View {
    GeometryReader { geometry in
      let contentWidth = min(1200, max(0, geometry.size.width - 48))
      let columns = contentWidth >= minimumColumnsWidth && !dynamicTypeSize.isAccessibilitySize
      let layout =
        columns
        ? AnyLayout(HStackLayout(alignment: .top, spacing: 32))
        : AnyLayout(VStackLayout(alignment: .leading, spacing: 32))
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          HomeNotices(showNotifications: $showNotifications, showApplications: $showApplications)
          layout {
            if let incident = nearby ?? model.incidents.first {
              FeaturedOpportunity(
                incident: incident, isNearby: nearby != nil, navigation: navigation
              )
              .frame(maxWidth: columns ? contentWidth * 0.58 : .infinity, alignment: .leading)
            }
            VolunteerGuides(articles: model.articles)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          if model.incidents.isEmpty && !model.loading {
            ContentUnavailableView(
              L10n.text("no_content"), systemImage: "wifi",
              description: Text(L10n.text("refresh_later")))
          }
        }
        .padding(24)
        .frame(maxWidth: 1248, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .refreshable { await model.load() }
    }
    .navigationTitle("FireLink")
    .navigationDestination(isPresented: $showNotifications) { NotificationHistoryView() }
    .navigationDestination(isPresented: $showApplications) { ApplicationHistoryView() }
    .overlay { if model.loading && model.incidents.isEmpty { ProgressView() } }
  }
}

private struct HomeNotices: View {
  @EnvironmentObject var model: AppModel
  @Binding var showNotifications: Bool
  @Binding var showApplications: Bool
  @State private var opening = false

  var body: some View {
    let unread = Array(model.notifications.filter { $0.readAt == nil }.prefix(2))
    if !unread.isEmpty {
      VStack(spacing: 0) {
        ForEach(unread) { notice in
          if notice.id != unread.first?.id { Divider().padding(.horizontal, 14) }
          Button {
            opening = true
            Task {
              defer { opening = false }
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
            HStack(alignment: .top, spacing: 12) {
              Image(systemName: "bell.badge").foregroundStyle(.tint)
              VStack(alignment: .leading, spacing: 4) {
                Text(notice.title).fontWeight(.semibold)
                Text(notice.body).foregroundStyle(.secondary)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              Image(systemName: "chevron.right").foregroundStyle(.secondary)
            }
            .font(.subheadline).padding(14).frame(minHeight: 44)
          }
          .buttonStyle(.plain).disabled(opening)
          .accessibilityLabel(L10n.text("unread_notice", notice.title, notice.body))
          .accessibilityIdentifier("unread-notice-" + notice.id)
        }
      }
      .background(.tint.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }
  }
}

private struct FeaturedOpportunity: View {
  let incident: Incident
  let isNearby: Bool
  let navigation: AppNavigation

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(L10n.text(isNearby ? "nearby_opportunities" : "recruiting")).font(.title2.bold())
      Button {
        navigation.openIncident(incident.id)
      } label: {
        IncidentCard(incident: incident)
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("incident-" + incident.id)
    }
  }
}

private struct VolunteerGuides: View {
  let articles: [Article]

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(L10n.text("guides")).font(.title2.bold())
      ForEach(articles) { article in
        NavigationLink {
          ScrollView { ContentBlocks(blocks: article.blocks).padding(24).readableContent() }
            .navigationTitle(article.title).inlineNavigationTitle()
        } label: {
          HStack(alignment: .top, spacing: 14) {
            Image(systemName: "book.closed").font(.title2).foregroundStyle(.tint)
              .frame(width: 40, height: 48)
            VStack(alignment: .leading, spacing: 8) {
              Text(article.title).font(.headline)
              Text(article.summary).font(.subheadline).foregroundStyle(.secondary)
              Text(L10n.text("article_read_time", article.category, article.minutes))
                .font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          .padding(.vertical, 12)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        if article.id != articles.last?.id { Divider() }
      }
    }
  }
}

struct MapPreview: View {
  let latitude: Double
  let longitude: Double
  var height: CGFloat? = nil
  var body: some View {
    let point = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    Color.clear
      .aspectRatio(1.9, contentMode: .fit)
      .frame(maxWidth: .infinity, maxHeight: height ?? 300)
      .frame(height: height)
      .overlay {
        Map(
          initialPosition: .region(
            MKCoordinateRegion(
              center: point,
              span: MKCoordinateSpan(latitudeDelta: 0.035, longitudeDelta: 0.035))),
          interactionModes: []
        ) { Marker(L10n.text("location"), coordinate: point).tint(.orange) }
        .mapStyle(.standard(elevation: .flat))
        .allowsHitTesting(false)
        .accessibilityLabel(L10n.text("coordinates", latitude, longitude))
      }
      .clipped()
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
        HStack(spacing: 12) {
          Text(incident.title).font(.title3.bold())
          Spacer(minLength: 0)
          Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
        }
        Text(incident.region).font(.caption).foregroundStyle(.secondary)
        ForEach(incident.tasks.prefix(3)) { task in
          HStack {
            Circle().fill(.tint).frame(width: 5, height: 5)
            Text(task.title).font(.subheadline)
            Spacer()
          }
        }
        Text(L10n.text("updated_at", displayDate(incident.updatedAt))).font(.caption2)
          .foregroundStyle(.secondary)
      }.padding(16)
    }.contentSurface(cornerRadius: 16)
      .clipShape(RoundedRectangle(cornerRadius: 16))
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
struct IncidentView: View {
  let incident: Incident
  let navigation: BrowseNavigation
  let selectsInPlace: Bool

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Text(incident.title).font(.title.bold())
        VStack(alignment: .leading, spacing: 12) {
          MapPreview(latitude: incident.latitude, longitude: incident.longitude)
            .clipShape(RoundedRectangle(cornerRadius: 12))
          Label(incident.region, systemImage: "mappin.and.ellipse")
            .font(.subheadline).foregroundStyle(.secondary)
        }
        VStack(alignment: .leading, spacing: 12) {
          Text(L10n.text("tasks")).font(.title2.bold())
          ForEach(incident.tasks) { task in
            let destination = BrowseDestination.task(id: task.id, incidentID: incident.id)
            Group {
              if selectsInPlace {
                Button {
                  navigation.selection = destination
                } label: {
                  IncidentTaskRow(task: task)
                }
              } else {
                NavigationLink(value: destination) { IncidentTaskRow(task: task) }
              }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("task-" + task.id)
            if task.id != incident.tasks.last?.id { Divider() }
          }
        }
      }
      .padding(24)
      .readableContent()
    }
    .navigationTitle(incident.title).inlineNavigationTitle()
  }
}

private struct IncidentTaskRow: View {
  let task: TaskSummary
  var body: some View {
    HStack(spacing: 16) {
      TaskSummaryRow(task: task)
      Spacer(minLength: 0)
      Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
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
              PlatformSupport.secondaryBackground, in: RoundedRectangle(cornerRadius: 12))
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
  @State private var customAnswers: [String: String] = [:]
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
      if let customFields = task.customFields, !customFields.isEmpty {
        CustomApplicationFields(fields: customFields, answers: $customAnswers)
      }
      Section { Toggle(L10n.text("confirm_consent"), isOn: $consent) }
      if let failure { Section { Text(failure).foregroundStyle(.red) } }
      Section {
        Button(busy ? L10n.text("submitting") : L10n.text("confirm_application")) {
          Task { await submit() }
        }.disabled(!canSubmit)
      }
    }.navigationTitle(L10n.text("application_consent")).toolbar {
      ToolbarItem(placement: .cancellationAction) { Button(L10n.text("cancel")) { dismiss() } }
    }
    .onAppear {
      fields = Set(task.requiredFields)
      contacts = Set(task.contactFields)
    }
  }
  private var canSubmit: Bool {
    consent && !busy
      && (task.customFields ?? []).allSatisfy {
        let answer = customAnswers[$0, default: ""].trimmingCharacters(in: .whitespacesAndNewlines)
        return !answer.isEmpty && answer.utf16.count <= 1000
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
          "customAnswers": customAnswers,
        ])
      try await model.refreshPrivate()
      dismiss()
    } catch { failure = error.localizedDescription }
  }
}

private struct CustomApplicationFields: View {
  let fields: [String]
  @Binding var answers: [String: String]

  var body: some View {
    Section(L10n.text("custom_fields")) {
      ForEach(fields, id: \.self) { field in
        VStack(alignment: .leading) {
          Text(field + L10n.text("required_suffix"))
          TextField(
            L10n.text("custom_field_answer"),
            text: Binding(
              get: { answers[field, default: ""] },
              set: { answers[field] = $0 }
            ), axis: .vertical
          )
          .lineLimit(2...6)
          .accessibilityLabel(field + L10n.text("required_suffix"))
          Text("\(answers[field, default: ""].utf16.count)/1000")
            .font(.caption).foregroundStyle(.secondary)
        }
      }
    }
  }
}
