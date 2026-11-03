import Foundation
import Security
import SwiftUI

struct ServiceError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}
enum TokenStore {
  static let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "cn.firelink.session",
    kSecAttrAccount as String: "volunteer",
  ]
  static func read() -> String? {
    var q = query
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }
  static func save(_ token: String?) {
    SecItemDelete(query as CFDictionary)
    if let token {
      var q = query
      q[kSecValueData as String] = Data(token.utf8)
      q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      SecItemAdd(q as CFDictionary, nil)
    }
  }
}
@MainActor final class AppModel: ObservableObject {
  static let defaultServer = "https://firelink-demo.surindaku.workers.dev"
  @Published var profile: Profile?
  @Published var incidents: [Incident] = []
  @Published var articles: [Article] = []
  @Published var applications: [Application] = []
  @Published var notifications: [Notice] = []
  @Published var config: ServerConfig?
  @Published var error: String?
  @Published var loading = false
  @Published var showLogin = false
  @Published var demoSessionID: String?
  var afterLogin: (() -> Void)?
  var token = TokenStore.read()
  private let session: URLSession
  private var loadTask: Task<Void, Never>?

  init(session: URLSession = .shared) {
    self.session = session
    let saved = UserDefaults.standard.string(forKey: "serverURL")
    if !ProcessInfo.processInfo.arguments.contains("--ui-test")
      && (saved == nil || saved == "http://localhost:8787")
    {
      UserDefaults.standard.set(Self.defaultServer, forKey: "serverURL")
      token = nil
      TokenStore.save(nil)
    }
  }

  var baseURL: String {
    UserDefaults.standard.string(forKey: "serverURL") ?? Self.defaultServer
  }
  func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil)
    async throws -> T
  {
    guard let url = URL(string: baseURL + path) else {
      throw ServiceError(message: L10n.text("invalid_server"))
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue(L10n.language, forHTTPHeaderField: "Accept-Language")
    request.timeoutInterval = 20
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let body {
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw ServiceError(message: L10n.text("invalid_response"))
    }
    guard (200..<300).contains(http.statusCode) else {
      if http.statusCode == 401 {
        token = nil
        TokenStore.save(nil)
        profile = nil
        applications = []
        notifications = []
        incidents = []
      }
      let info = try? JSONSerialization.jsonObject(with: data) as? [String: String]
      throw ServiceError(message: info?["error"] ?? L10n.text("request_failed"))
    }
    return try JSONDecoder().decode(T.self, from: data)
  }
  func load() async {
    if let loadTask {
      await loadTask.value
      return
    }
    // Refresh updates shared app state. Keep it alive when SwiftUI replaces the
    // refresh action during a view update, and share it with overlapping callers.
    let task = Task { await loadContent() }
    loadTask = task
    defer { loadTask = nil }
    await task.value
  }
  private func loadContent() async {
    loading = true
    defer { loading = false }
    do {
      let config: ServerConfig = try await request("/v1/config")
      let incidents: [Incident] = try await request("/v1/incidents")
      let articles: [Article] = try await request("/v1/articles")
      self.config = config
      self.incidents = incidents
      self.articles = articles
      if token != nil { try await refreshPrivate() }
    } catch is CancellationError {
      // Cancellation is not a user-facing failure.
    } catch let error as URLError where error.code == .cancelled {
      // URLSession reports cancellation as URLError rather than CancellationError.
    } catch { self.error = error.localizedDescription }
  }
  func refreshPrivate() async throws {
    profile = try await request("/v1/me")
    applications = try await request("/v1/applications")
    try await refreshNotifications()
  }
  func refreshNotifications() async throws {
    notifications = try await request("/v1/notifications")
  }
  func markNotificationRead(_ id: String) async throws {
    guard notifications.contains(where: { $0.id == id && $0.readAt == nil }) else { return }
    let _: OK = try await request("/v1/notifications/\(id)/read", method: "POST")
    if let index = notifications.firstIndex(where: { $0.id == id }) {
      notifications[index].readAt = ISO8601DateFormatter().string(from: Date())
    }
  }
  func authenticated(_ action: @escaping () -> Void) {
    if profile != nil {
      action()
    } else {
      afterLogin = action
      showLogin = true
    }
  }
  func accept(_ result: AuthResult) async throws {
    guard let token = result.token, let profile = result.profile else {
      throw ServiceError(message: L10n.text("invalid_login"))
    }
    self.token = token
    TokenStore.save(token)
    self.profile = profile
    showLogin = false
    let action = afterLogin
    afterLogin = nil
    action?()
    try await refreshPrivate()
  }
  func logout() async {
    do {
      let _: OK = try await request("/v1/me/logout", method: "POST")
      token = nil
      TokenStore.save(nil)
      profile = nil
      applications = []
      notifications = []
      incidents = []
      await load()
    } catch { self.error = error.localizedDescription }
  }
  func enterDemo() async throws {
    // Finish any public refresh before replacing it with the demo workspace.
    if let loadTask { await loadTask.value }
    let result: AuthResult = try await request("/v1/auth/demo", method: "POST", body: [:])
    afterLogin = nil
    guard let token = result.token, let profile = result.profile else {
      throw ServiceError(message: L10n.text("invalid_login"))
    }
    self.token = token
    TokenStore.save(token)
    self.profile = profile
    try await refreshPrivate()
    incidents = try await request("/v1/incidents")
    articles = try await request("/v1/articles")
    error = nil
    demoSessionID = profile.id
    showLogin = false
  }
  func upload(data: Data, filename: String, mime: String, title: String) async throws {
    guard data.count <= 8 * 1024 * 1024 else {
      throw ServiceError(message: L10n.text("attachment_too_large"))
    }
    var request = URLRequest(url: URL(string: baseURL + "/v1/credentials")!)
    request.httpMethod = "POST"
    request.setValue(L10n.language, forHTTPHeaderField: "Accept-Language")
    request.httpBody = data
    request.setValue("Bearer \(token ?? "")", forHTTPHeaderField: "Authorization")
    request.setValue(mime, forHTTPHeaderField: "Content-Type")
    request.setValue(
      title.addingPercentEncoding(withAllowedCharacters: .alphanumerics),
      forHTTPHeaderField: "X-Certificate-Title")
    request.setValue(
      filename.addingPercentEncoding(withAllowedCharacters: .alphanumerics),
      forHTTPHeaderField: "X-File-Name")
    let (body, response) = try await session.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 201 else {
      let info = try? JSONSerialization.jsonObject(with: body) as? [String: String]
      throw ServiceError(message: info?["error"] ?? L10n.text("upload_failed"))
    }
  }
}
