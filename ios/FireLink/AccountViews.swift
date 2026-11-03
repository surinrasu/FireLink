import SwiftUI
import UniformTypeIdentifiers

struct LoginView: View {
  @EnvironmentObject var model: AppModel
  @StateObject private var passkeys = NativePasskeys()
  @Environment(\.dismiss) var dismiss
  @State private var phone = ""
  @State private var code = ""
  @State private var challenge: SMSResult?
  @State private var registration: String?
  @State private var realName = ""
  @State private var idNumber = ""
  @State private var consent = false
  @State private var busy = false
  @State private var failure: String?
  var body: some View {
    Form {
      Section {
        VStack(alignment: .leading, spacing: 10) {
          Image(systemName: "flame.fill").font(.largeTitle).foregroundStyle(.tint)
          Text(registration == nil ? L10n.text("welcome") : L10n.text("create_profile")).font(
            .title2.bold())
        }.padding(.vertical)
      }
      if registration != nil {
        Section(L10n.text("phone_not_registered")) {
          TextField(L10n.text("real_name"), text: $realName).textContentType(.name)
          TextField(L10n.text("id_number"), text: $idNumber).textInputAutocapitalization(
            .characters
          )
          .autocorrectionDisabled()
          Toggle(L10n.text("registration_consent"), isOn: $consent)
          Button(L10n.text("register_verify")) {
            perform {
              let result: AuthResult = try await model.request(
                "/v1/auth/register", method: "POST",
                body: [
                  "registrationToken": registration!, "realName": realName, "idNumber": idNumber,
                  "consent": true,
                ])
              try await model.accept(result)
            }
          }.disabled(!consent || realName.isEmpty || idNumber.count != 18 || busy)
        }
      } else {
        Section(L10n.text("phone_sign_in")) {
          HStack {
            Text("+86").foregroundStyle(.secondary)
            TextField(L10n.text("mainland_phone"), text: $phone).keyboardType(.phonePad)
              .textContentType(
                .username)
          }.disabled(challenge != nil)
          if let challenge {
            TextField(L10n.text("verification_code"), text: $code).keyboardType(.numberPad)
              .textContentType(.oneTimeCode)
            Button(L10n.text("verify_continue")) {
              perform {
                let result: AuthResult = try await model.request(
                  "/v1/auth/verify", method: "POST",
                  body: ["challengeId": challenge.challengeId, "code": code])
                if let token = result.registrationToken {
                  registration = token
                  if let identity = model.config?.mockIdentity {
                    try await LocalNotifications.shared.send(
                      id: "identity", title: L10n.text("identity_information"),
                      body: L10n.text("identity_notification", identity.realName, identity.idNumber)
                    )
                  }
                } else {
                  try await model.accept(result)
                }
              }
            }.disabled(busy)
            Button(L10n.text("resend_change_phone")) {
              self.challenge = nil
              code = ""
            }.disabled(busy)
          } else {
            Button(L10n.text("request_code")) {
              perform {
                if model.config?.mockAuth == true { try await LocalNotifications.shared.prepare() }
                challenge = try await model.request(
                  "/v1/auth/sms", method: "POST", body: ["phone": phone])
                if let code = challenge?.mockCode {
                  try await LocalNotifications.shared.send(
                    id: "sms", title: L10n.text("code_notification_title"),
                    body: L10n.text("code_notification_body", code))
                }
              }
            }.disabled(phone.isEmpty || busy)
          }
        }
      }
      if registration == nil && challenge == nil && model.config?.demo == true {
        Section {
          Button(L10n.text("enter_demo_client")) {
            passkeys.cancel()
            perform { try await model.enterDemo() }
          }.disabled(busy)
        }
      }
      if let failure { Section { Text(failure).foregroundStyle(.red) } }
      if busy { ProgressView() }
    }.task(id: "\(model.config?.passkeys == true)-\(challenge == nil)") {
      guard model.config?.passkeys == true, challenge == nil else { return }
      do { try await passkeys.login(model: model) } catch is CancellationError {} catch {
        failure = error.localizedDescription
      }
    }
    .onDisappear { passkeys.cancel() }
    .navigationTitle(L10n.text("sign_in")).navigationBarTitleDisplayMode(.inline).toolbar {
      ToolbarItem(placement: .cancellationAction) { Button(L10n.text("cancel")) { dismiss() } }
    }
  }
  func perform(_ action: @escaping () async throws -> Void) {
    busy = true
    failure = nil
    Task {
      defer { busy = false }
      do { try await action() } catch { failure = error.localizedDescription }
    }
  }
}
struct AccountView: View {
  @EnvironmentObject var model: AppModel
  var body: some View {
    List {
      if let profile = model.profile {
        Section {
          HStack(spacing: 16) {
            Image(systemName: "person.crop.circle.fill").font(.system(size: 52)).foregroundStyle(
              .tint)
            VStack(alignment: .leading, spacing: 6) {
              Text(profile.username).font(.title2.bold())
              Text(L10n.text("identity_verified")).font(.caption).foregroundStyle(.secondary)
            }
          }.padding(.vertical, 12)
        }
        Section {
          NavigationLink {
            ProfileView(profile: profile)
          } label: {
            Label(L10n.text("profile"), systemImage: "person.text.rectangle")
          }
          NavigationLink {
            SkillsView()
          } label: {
            Label(L10n.text("qualifications"), systemImage: "checkmark.seal")
          }
          NavigationLink {
            ApplicationHistoryView()
          } label: {
            Label(L10n.text("application_history"), systemImage: "list.bullet.clipboard")
          }
          NavigationLink {
            NotificationHistoryView()
          } label: {
            HStack {
              Label(L10n.text("notification_history"), systemImage: "bell")
              Spacer()
              let unreadCount = model.notifications.filter { $0.readAt == nil }.count
              if unreadCount > 0 {
                Text(L10n.text("unread_count", unreadCount)).font(.subheadline).foregroundStyle(
                  .tint)
              }
            }
          }.accessibilityIdentifier("notification-history")
        }
      } else {
        Section {
          Text(L10n.text("account_sign_in_hint"))
          Button(L10n.text("sign_in_register")) { model.showLogin = true }
        }
      }
      Section {
        NavigationLink {
          SettingsView()
        } label: {
          Label(L10n.text("settings"), systemImage: "gearshape")
        }
      }
    }.navigationTitle(L10n.text("account")).refreshable {
      if model.token != nil {
        do { try await model.refreshPrivate() } catch { model.error = error.localizedDescription }
      }
    }
  }
}
struct ProfileView: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.dismiss) var dismiss
  @State var profile: Profile
  @State var busy = false
  @State var reverify = false
  @State var saved = false
  var body: some View {
    Form {
      Section(L10n.text("public_name")) {
        TextField(L10n.text("username"), text: $profile.username)
        TextField(L10n.text("optional_pronouns"), text: $profile.pronouns)
      }
      Section {
        RegionPicker(
          region: Binding(
            get: { profile.region },
            set: {
              profile.region = $0
              saved = false
            }))
      } header: {
        Text(L10n.text("region"))
      } footer: {
        Text(L10n.text("region_hint"))
      }
      Section(L10n.text("vehicles")) {
        ForEach(vehicleTypes, id: \.0) { key, label in
          let count = profile.vehicles?[key] ?? 0
          HStack {
            Text(L10n.text(label))
            Spacer()
            Button {
              setVehicle(key, count - 1)
            } label: {
              Image(systemName: "minus")
            }
            .frame(minWidth: 44, minHeight: 44)
            .disabled(count == 0)
            .accessibilityLabel(L10n.text("vehicle_decrease", L10n.text(label)))
            .accessibilityIdentifier("vehicle-minus-\(key)")
            Text("\(count)").monospacedDigit().frame(minWidth: 30)
              .accessibilityIdentifier("vehicle-count-\(key)")
            Button {
              setVehicle(key, count + 1)
            } label: {
              Image(systemName: "plus")
            }
            .frame(minWidth: 44, minHeight: 44)
            .disabled(count >= 999)
            .accessibilityLabel(L10n.text("vehicle_increase", L10n.text(label)))
            .accessibilityIdentifier("vehicle-plus-\(key)")
          }.buttonStyle(.borderless)
        }
      }
      Section(L10n.text("equipment")) {
        TextField(
          L10n.text("equipment_text_hint"),
          text: Binding(
            get: { profile.equipmentText },
            set: {
              profile.equipmentDescription = $0
              saved = false
            }
          ), axis: .vertical
        )
        .lineLimit(4...8)
        .accessibilityIdentifier("equipment-description")
      }
      Section(L10n.text("identity_information")) {
        LabeledContent(L10n.text("real_name"), value: profile.realName)
        LabeledContent(L10n.text("age"), value: L10n.text("age_years", profile.age))
        LabeledContent(L10n.text("gender"), value: L10n.gender(profile.gender))
        Button(L10n.text("reverify_identity")) { reverify = true }
      }
      Section {
        TextField(L10n.text("contact_phone"), text: $profile.contacts.phone).keyboardType(.phonePad)
        TextField(L10n.text("optional_wechat"), text: $profile.contacts.wechat)
          .textInputAutocapitalization(.never)
        TextField(L10n.text("optional_email"), text: $profile.contacts.email).keyboardType(
          .emailAddress
        )
        .textInputAutocapitalization(.never)
      } header: {
        Text(L10n.text("contact_details"))
      } footer: {
        Text(L10n.text("profile_contacts_hint"))
      }
      if saved {
        Label(L10n.text("saved"), systemImage: "checkmark.circle").foregroundStyle(.green)
      }
    }.navigationTitle(L10n.text("profile")).toolbar {
      Button(busy ? L10n.text("saving") : L10n.text("save")) { Task { await save() } }.disabled(
        busy)
    }
    .onAppear {
      if profile.equipmentDescription == nil {
        profile.equipmentDescription = profile.equipmentText
      }
    }
    .sheet(isPresented: $reverify) {
      NavigationStack {
        IdentityVerificationView { result in
          profile.realName = result.realName
          profile.birthDate = result.birthDate
          profile.gender = result.gender
        }
      }
    }
  }
  func setVehicle(_ key: String, _ count: Int) {
    var vehicles = profile.vehicles ?? [:]
    vehicles[key] = min(999, max(0, count))
    profile.vehicles = vehicles
    saved = false
  }
  func save() async {
    saved = false
    busy = true
    defer { busy = false }
    do {
      let data = try JSONEncoder().encode(profile)
      let body = try JSONSerialization.jsonObject(with: data) as! [String: Any]
      let result: Profile = try await model.request("/v1/me", method: "PATCH", body: body)
      model.profile = result
      profile = result
      saved = true
    } catch { model.error = error.localizedDescription }
  }

}
struct IdentityVerificationView: View {
  @EnvironmentObject var model: AppModel
  @Environment(\.dismiss) var dismiss
  let onVerified: (Profile) -> Void
  @State var realName = ""
  @State var idNumber = ""
  @State var busy = false
  @State var failure: String?
  var body: some View {
    Form {
      Section(L10n.text("identity_verification")) {
        TextField(L10n.text("real_name"), text: $realName).textContentType(.name)
        TextField(L10n.text("id_number"), text: $idNumber).textInputAutocapitalization(.characters)
          .autocorrectionDisabled()
      }
      if let failure { Text(failure).foregroundStyle(.red) }
      Button(busy ? L10n.text("verifying_identity") : L10n.text("confirm_verification")) {
        Task {
          busy = true
          defer { busy = false }
          do {
            let result: Profile = try await model.request(
              "/v1/me/reverify", method: "POST",
              body: ["realName": realName, "idNumber": idNumber])
            model.profile = result
            onVerified(result)
            dismiss()
          } catch { failure = error.localizedDescription }
        }
      }.disabled(busy || realName.isEmpty || idNumber.count != 18)
    }.navigationTitle(L10n.text("reverify_identity")).toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button(L10n.text("cancel")) { dismiss() }.disabled(busy)
      }
    }.task {
      if let identity = model.config?.mockIdentity {
        do {
          try await LocalNotifications.shared.send(
            id: "identity", title: L10n.text("identity_information"),
            body: L10n.text("identity_notification", identity.realName, identity.idNumber))
        } catch { failure = error.localizedDescription }
      }
    }
  }
}
struct SkillsView: View {
  @EnvironmentObject var model: AppModel
  @State var credentials: [Credential] = []
  @State var title = ""
  @State var importing = false
  @State var busy = false
  var body: some View {
    Form {
      Section {
        TextField(L10n.text("certificate_name"), text: $title)
        Button(busy ? L10n.text("uploading") : L10n.text("choose_upload")) { importing = true }
          .disabled(
            title.trimmingCharacters(in: .whitespaces).isEmpty || busy)
      } header: {
        Text(L10n.text("add_certificate"))
      } footer: {
        Text(L10n.text("upload_hint"))
      }
      Section(L10n.text("my_qualifications")) {
        ForEach(credentials) { item in
          VStack(alignment: .leading, spacing: 6) {
            Text(item.title).font(.headline)
            Text(item.filename).font(.caption)
            Text(
              item.status == "uploaded" ? L10n.text("uploaded_unverified") : L10n.text("verified")
            ).font(.caption).foregroundStyle(
              .secondary)
          }
        }
        if credentials.isEmpty { Text(L10n.text("no_qualifications")).foregroundStyle(.secondary) }
      }
    }.navigationTitle(L10n.text("qualifications")).task { await reload() }
      .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .jpeg, .png]) { result in
        switch result {
        case .success(let url):
          Task {
            busy = true
            defer { busy = false }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            do {
              let data = try Data(contentsOf: url)
              let mime =
                UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                ?? "application/octet-stream"
              try await model.upload(
                data: data, filename: url.lastPathComponent, mime: mime, title: title)
              title = ""
              await reload()
            } catch { model.error = error.localizedDescription }
          }
        case .failure(let error): model.error = error.localizedDescription
        }
      }
  }
  func reload() async {
    do { credentials = try await model.request("/v1/credentials") } catch {
      model.error = error.localizedDescription
    }
  }
}
struct ApplicationHistoryView: View {
  @EnvironmentObject var model: AppModel
  var body: some View {
    List {
      if model.applications.isEmpty {
        ContentUnavailableView(
          L10n.text("no_applications"), systemImage: "tray",
          description: Text(L10n.text("no_applications_hint")))
      }
      ForEach(model.applications) { item in
        Section {
          NavigationLink {
            TaskDetailView(id: item.taskId)
          } label: {
            Text(item.taskTitle).font(.headline)
          }
          LabeledContent(L10n.text("status"), value: item.statusLabel)
          Text(item.organizerName).font(.caption).foregroundStyle(.secondary)
          if let response = item.response { Text(response) }
          Text(
            item.contactsReleased
              ? L10n.text(
                "authorized_contacts",
                item.contactFields.map { fieldLabels[$0] ?? $0 }.joined(
                  separator: L10n.text("list_separator")))
              : L10n.text("contacts_private")
          ).font(.caption).foregroundStyle(item.contactsReleased ? .green : .secondary)
          Text(L10n.text("applied_at", displayDate(item.createdAt))).font(.caption).foregroundStyle(
            .secondary)
          if item.status == "pending" {
            Button(L10n.text("withdraw_application"), role: .destructive) {
              Task {
                do {
                  let _: OK = try await model.request(
                    "/v1/applications/\(item.id)/withdraw", method: "POST")
                  try await model.refreshPrivate()
                } catch { model.error = error.localizedDescription }
              }
            }
          }
        }
      }
    }.navigationTitle(L10n.text("application_history")).task { await reload() }.refreshable {
      await reload()
    }
  }
  func reload() async {
    do { try await model.refreshPrivate() } catch { model.error = error.localizedDescription }
  }
}
struct SettingsView: View {
  @EnvironmentObject var model: AppModel
  @AppStorage("nearbyEnabled") var nearbyEnabled = true
  var body: some View {
    Form {
      Section {
        Toggle(L10n.text("nearby_setting"), isOn: $nearbyEnabled)
        Text(L10n.text("nearby_setting_hint")).font(.caption).foregroundStyle(.secondary)
      }
      if model.profile != nil {
        Section(L10n.text("account_security")) {
          NavigationLink {
            PasskeySettingsView()
          } label: {
            Label(L10n.text("passkeys"), systemImage: "person.badge.key")
          }
        }
      }
      Section {
        LabeledContent(L10n.text("version"), value: L10n.text("version_value"))
        Text(L10n.text("service_description")).font(.caption).foregroundStyle(.secondary)
      }
      if model.profile != nil {
        Section {
          Button(L10n.text("sign_out"), role: .destructive) { Task { await model.logout() } }
        }
      }
    }.navigationTitle(L10n.text("settings"))
  }
}
