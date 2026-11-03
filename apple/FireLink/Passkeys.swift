import AuthenticationServices
import SwiftUI

#if os(macOS)
  import AppKit
#else
  import UIKit
#endif

struct PasskeyEntry: Codable, Identifiable {
  let id: String
  let createdAt: String
}
private struct PasskeyLoginChallenge: Decodable {
  let challengeId: String
  let options: Options
  struct Options: Decodable {
    let challenge: String
    let rpId: String
  }
}
private struct PasskeyRegistrationChallenge: Decodable {
  let challengeId: String
  let options: Options
  struct Options: Decodable {
    let challenge: String
    let rp: RelyingParty
    let user: User
    let excludeCredentials: [CredentialID]
  }
  struct RelyingParty: Decodable { let id: String }
  struct User: Decodable {
    let id: String
    let name: String
    let displayName: String
  }
  struct CredentialID: Decodable { let id: String }
}

extension Data {
  init?(base64URL value: String) {
    let base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(
      of: "_", with: "/")
    self.init(base64Encoded: base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4))
  }
  var base64URL: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}

@MainActor
final class NativePasskeys: NSObject, ObservableObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private var controller: ASAuthorizationController?
  private var continuation: CheckedContinuation<[String: Any], Error>?
  private weak var window: ASPresentationAnchor?

  static var supportsAutoFill: Bool {
    #if os(macOS)
      false
    #else
      true
    #endif
  }

  func login(model: AppModel) async throws {
    let challenge: PasskeyLoginChallenge = try await model.request(
      "/v1/auth/passkeys/options", method: "POST")
    guard let bytes = Data(base64URL: challenge.options.challenge) else {
      throw ServiceError(message: L10n.text("passkey_login_start_failed"))
    }
    let request = ASAuthorizationPlatformPublicKeyCredentialProvider(
      relyingPartyIdentifier: challenge.options.rpId
    )
    .createCredentialAssertionRequest(challenge: bytes)
    request.userVerificationPreference = .required
    // AutoFill presents only matching credentials on iPhone, iPad, and Vision Pro.
    let response = try await authorize(request, autoFill: true)
    try Task.checkCancellation()
    let result: AuthResult = try await model.request(
      "/v1/auth/passkeys/verify", method: "POST",
      body: ["challengeId": challenge.challengeId, "response": response])
    try await model.accept(result)
  }

  func create(model: AppModel) async throws {
    guard model.config?.passkeys == true else {
      throw ServiceError(message: L10n.text("passkey_unavailable"))
    }
    let challenge: PasskeyRegistrationChallenge = try await model.request(
      "/v1/me/passkeys/options", method: "POST")
    guard let bytes = Data(base64URL: challenge.options.challenge),
      let userID = Data(base64URL: challenge.options.user.id)
    else {
      throw ServiceError(message: L10n.text("passkey_create_start_failed"))
    }
    let request = ASAuthorizationPlatformPublicKeyCredentialProvider(
      relyingPartyIdentifier: challenge.options.rp.id
    )
    .createCredentialRegistrationRequest(
      challenge: bytes, name: challenge.options.user.name, userID: userID)
    request.displayName = challenge.options.user.displayName
    request.userVerificationPreference = .required
    #if !os(visionOS)
      if #available(iOS 17.4, macOS 13.5, *) {
        request.excludedCredentials = challenge.options.excludeCredentials.compactMap {
          guard let id = Data(base64URL: $0.id) else { return nil }
          return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: id)
        }
      }
    #endif
    let response = try await authorize(request, autoFill: false)
    let _: OK = try await model.request(
      "/v1/me/passkeys/verify", method: "POST",
      body: ["challengeId": challenge.challengeId, "response": response])
  }

  private func authorize(_ request: ASAuthorizationRequest, autoFill: Bool) async throws -> [String:
    Any]
  {
    try Task.checkCancellation()
    guard controller == nil else {
      throw ServiceError(message: L10n.text("verification_in_progress"))
    }
    #if os(macOS)
      window = NSApplication.shared.keyWindow ?? NSApplication.shared.mainWindow
    #else
      window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        .filter { $0.activationState == .foregroundActive }.flatMap(\.windows).first {
          $0.isKeyWindow
        }
    #endif
    guard window != nil else { throw ServiceError(message: L10n.text("return_to_app")) }
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        self.continuation = continuation
        let controller = ASAuthorizationController(authorizationRequests: [request])
        self.controller = controller
        controller.delegate = self
        controller.presentationContextProvider = self
        #if os(macOS)
          controller.performRequests()
        #else
          if autoFill {
            controller.performAutoFillAssistedRequests()
          } else {
            controller.performRequests()
          }
        #endif
      }
    } onCancel: {
      Task { @MainActor in self.cancel() }
    }
  }
  func cancel() {
    let active = controller
    finish(.failure(CancellationError()))
    active?.cancel()
  }
  private func finish(_ result: Result<[String: Any], Error>) {
    let pending = continuation
    continuation = nil
    controller = nil
    pending?.resume(with: result)
  }
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    window ?? ASPresentationAnchor()
  }
  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    guard controller === self.controller else { return }
    let result: [String: Any]
    if let key = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
      result = [
        "id": key.credentialID.base64URL, "rawId": key.credentialID.base64URL, "type": "public-key",
        "clientExtensionResults": [String: String](),
        "response": [
          "clientDataJSON": key.rawClientDataJSON.base64URL,
          "authenticatorData": key.rawAuthenticatorData.base64URL,
          "signature": key.signature.base64URL,
          "userHandle": key.userID.base64URL,
        ],
      ]
    } else if let key = authorization.credential
      as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
      let attestation = key.rawAttestationObject
    {
      result = [
        "id": key.credentialID.base64URL, "rawId": key.credentialID.base64URL, "type": "public-key",
        "clientExtensionResults": [String: String](),
        "response": [
          "clientDataJSON": key.rawClientDataJSON.base64URL,
          "attestationObject": attestation.base64URL, "transports": ["internal"],
        ],
      ]
    } else {
      finish(.failure(ServiceError(message: L10n.text("passkey_read_failed"))))
      return
    }
    finish(.success(result))
  }
  func authorizationController(
    controller: ASAuthorizationController, didCompleteWithError error: Error
  ) {
    guard controller === self.controller else { return }
    if let authorization = error as? ASAuthorizationError,
      authorization.code == .canceled || authorization.code == .notHandled
    {
      finish(.failure(CancellationError()))
    } else {
      finish(.failure(ServiceError(message: L10n.text("passkey_verification_incomplete"))))
    }
  }
}

struct PasskeySettingsView: View {
  @EnvironmentObject var model: AppModel
  @StateObject private var passkeys = NativePasskeys()
  @State private var entries: [PasskeyEntry] = []
  @State private var loaded = false
  @State private var busy = false
  @State private var deleting: PasskeyEntry?
  var body: some View {
    Form {
      Section {
        Button(busy ? L10n.text("adding") : L10n.text("add_passkey")) {
          Task {
            busy = true
            defer { busy = false }
            do {
              try await passkeys.create(model: model)
              try await reload()
            } catch is CancellationError {} catch { model.error = error.localizedDescription }
          }
        }.disabled(busy)
      } footer: {
        Text(L10n.text("passkey_hint"))
      }
      Section(L10n.text("saved_passkeys")) {
        if loaded && entries.isEmpty { Text(L10n.text("no_passkeys")).foregroundStyle(.secondary) }
        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
          VStack(alignment: .leading, spacing: 8) {
            Text(L10n.text("passkey_number", index + 1)).font(.headline)
            Text(L10n.text("added_at", displayDate(entry.createdAt))).font(.caption)
              .foregroundStyle(.secondary)
            Button(L10n.text("delete"), role: .destructive) { deleting = entry }.disabled(busy)
          }
        }
      }
    }.navigationTitle(L10n.text("passkeys"))
      .task { do { try await reload() } catch { model.error = error.localizedDescription } }
      .onDisappear { passkeys.cancel() }
      .confirmationDialog(
        L10n.text("delete_passkey_title"),
        isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
        titleVisibility: .visible
      ) {
        if let entry = deleting {
          Button(L10n.text("delete"), role: .destructive) {
            Task {
              busy = true
              defer { busy = false }
              do {
                let _: OK = try await model.request("/v1/me/passkeys/\(entry.id)", method: "DELETE")
                try await reload()
              } catch { model.error = error.localizedDescription }
            }
          }
        }
      } message: {
        Text(L10n.text("delete_passkey_hint"))
      }
  }
  func reload() async throws {
    entries = try await model.request("/v1/me/passkeys")
    loaded = true
  }
}
