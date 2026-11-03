import Combine
import XCTest

@testable import FireLink

final class RefreshTests: XCTestCase {
  @MainActor
  func testDemoEntryUsesServerSessionAndReloadsWorkspace() async throws {
    let previousToken = TokenStore.read()
    defer { TokenStore.save(previousToken) }
    var paths: [String] = []
    let (model, session) = makeModel { request in
      let path = try XCTUnwrap(request.url?.path)
      paths.append(path)
      if path == "/v1/auth/demo" {
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        return "{\"token\":\"demo-session\",\"profile\":\(Self.responses["/v1/me"]!)}"
      }
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer demo-session")
      return try XCTUnwrap(Self.responses[path])
    }
    defer { session.invalidateAndCancel() }
    model.showLogin = true
    model.afterLogin = { XCTFail("Demo entry must not resume a task from another workspace") }

    try await model.enterDemo()

    XCTAssertEqual(
      paths,
      [
        "/v1/auth/demo", "/v1/me", "/v1/applications", "/v1/notifications", "/v1/incidents",
        "/v1/articles",
      ])
    XCTAssertEqual(model.token, "demo-session")
    XCTAssertEqual(model.demoSessionID, "volunteer-new")
    XCTAssertEqual(model.incidents.first?.id, "incident-new")
    XCTAssertFalse(model.showLogin)
    XCTAssertNil(model.afterLogin)
  }
  @MainActor
  func testRefreshCompletesAfterViewCancellationAndSharesOverlappingRequests() async {
    var paths: [String] = []
    let (model, session) = makeModel { request in
      let path = try XCTUnwrap(request.url?.path)
      paths.append(path)
      return try XCTUnwrap(Self.responses[path])
    }
    defer { session.invalidateAndCancel() }
    model.token = "test-session"

    let first = Task { await model.load() }
    let second = Task { await model.load() }
    // Reproduce SwiftUI cancelling its refresh action when published state changes.
    let observation = model.$loading.dropFirst().sink { loading in
      if loading { first.cancel() }
    }
    await first.value
    await second.value
    observation.cancel()

    XCTAssertTrue(first.isCancelled)
    XCTAssertEqual(
      paths,
      [
        "/v1/config", "/v1/incidents", "/v1/articles", "/v1/me", "/v1/applications",
        "/v1/notifications",
      ])
    XCTAssertEqual(model.incidents.first?.id, "incident-new")
    XCTAssertEqual(model.articles.first?.id, "article-new")
    XCTAssertEqual(model.profile?.id, "volunteer-new")
    XCTAssertEqual(model.notifications.first?.id, "notice-new")
    XCTAssertNil(model.error)
    XCTAssertFalse(model.loading)
  }

  @MainActor
  func testCancelledRequestKeepsExistingContentWithoutAnAlert() async {
    let (model, session) = makeModel { request in
      if request.url?.path == "/v1/incidents" {
        throw NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)
      }
      return try XCTUnwrap(Self.responses[try XCTUnwrap(request.url?.path)])
    }
    defer { session.invalidateAndCancel() }
    let existing = Article(
      id: "article-existing", title: "Existing", summary: "", category: "Guide", minutes: 1,
      blocks: [])
    model.articles = [existing]

    await model.load()

    XCTAssertNil(model.error)
    XCTAssertNil(model.config)
    XCTAssertEqual(model.articles.first?.id, existing.id)
    XCTAssertFalse(model.loading)
  }

  @MainActor
  func testNetworkFailureIsReportedAndCanBeRetried() async {
    var shouldFail = true
    let failure = URLError(.timedOut)
    let (model, session) = makeModel { request in
      if shouldFail { throw failure }
      return try XCTUnwrap(Self.responses[try XCTUnwrap(request.url?.path)])
    }
    defer { session.invalidateAndCancel() }

    await model.load()
    XCTAssertEqual(model.error, failure.localizedDescription)
    XCTAssertFalse(model.loading)

    // Dismiss the error, then pull to refresh again.
    model.error = nil
    shouldFail = false
    await model.load()

    XCTAssertEqual(model.articles.first?.id, "article-new")
    XCTAssertNil(model.error)
    XCTAssertFalse(model.loading)
  }

  @MainActor
  private func makeModel(
    response: @escaping @MainActor (URLRequest) throws -> String
  ) -> (AppModel, URLSession) {
    RefreshURLProtocol.handler = { protocolInstance in
      do {
        let body = try response(protocolInstance.request)
        let url = try XCTUnwrap(protocolInstance.request.url)
        let http = try XCTUnwrap(
          HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]))
        protocolInstance.client?.urlProtocol(
          protocolInstance, didReceive: http, cacheStoragePolicy: .notAllowed)
        protocolInstance.client?.urlProtocol(protocolInstance, didLoad: Data(body.utf8))
        protocolInstance.client?.urlProtocolDidFinishLoading(protocolInstance)
      } catch {
        protocolInstance.client?.urlProtocol(protocolInstance, didFailWithError: error)
      }
    }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [RefreshURLProtocol.self]
    let session = URLSession(configuration: configuration)
    let model = AppModel(session: session)
    model.token = nil
    return (model, session)
  }

  private static let responses: [String: String] = [
    "/v1/config": #"{"mockAuth":false,"passkeys":false,"region":"Test","consentVersion":1}"#,
    "/v1/incidents":
      #"[{"id":"incident-new","title":"Updated incident","region":"Test","latitude":0,"longitude":0,"status":"open","updatedAt":"2026-10-15T00:00:00Z","tasks":[]}]"#,
    "/v1/articles":
      #"[{"id":"article-new","title":"Updated guide","summary":"","category":"Guide","minutes":1,"blocks":[]}]"#,
    "/v1/me":
      #"{"id":"volunteer-new","username":"Test","pronouns":"","realName":"Test","birthDate":"2000-01-01","gender":"","verified":true,"region":"Test","body":"","equipment":[],"contacts":{"phone":"","wechat":"","email":""}}"#,
    "/v1/applications": "[]",
    "/v1/notifications":
      #"[{"id":"notice-new","title":"Updated notice","body":"","createdAt":"2026-10-15T00:00:00Z"}]"#,
  ]
}

private final class RefreshURLProtocol: URLProtocol {
  @MainActor static var handler: ((RefreshURLProtocol) -> Void)?

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Task { @MainActor in Self.handler?(self) }
  }
  override func stopLoading() {}
}
