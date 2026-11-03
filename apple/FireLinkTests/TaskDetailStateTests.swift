import XCTest

@testable import FireLink

final class TaskDetailStateTests: XCTestCase {
  @MainActor
  func testLateResponseCannotReplaceNewlySelectedTask() async throws {
    let requested = expectation(description: "First task request started")
    var delayed: TaskDetailURLProtocol?
    let (model, session) = makeModel { request in
      if request.request.url?.lastPathComponent == "first" {
        delayed = request
        requested.fulfill()
      } else {
        request.respond(id: "second")
      }
    }
    defer { session.invalidateAndCancel() }
    let state = TaskDetailState()
    let first = Task { await state.load("first", using: model) }
    await fulfillment(of: [requested], timeout: 3)

    await state.load("second", using: model)
    try XCTUnwrap(delayed).respond(id: "first")
    await first.value

    XCTAssertEqual(state.task?.id, "second")
    XCTAssertNil(state.failure)
  }

  @MainActor
  func testCancelledTaskLoadDoesNotShowFailureAndCanBeRetried() async {
    let requested = expectation(description: "Task request started")
    var shouldWait = true
    let (model, session) = makeModel { request in
      if shouldWait { requested.fulfill() } else { request.respond(id: "first") }
    }
    defer { session.invalidateAndCancel() }
    let state = TaskDetailState()
    let request = Task { await state.load("first", using: model) }
    await fulfillment(of: [requested], timeout: 3)
    request.cancel()
    await request.value
    XCTAssertNil(state.failure)

    shouldWait = false
    await state.load("first", using: model)
    XCTAssertEqual(state.task?.id, "first")
    XCTAssertNil(state.failure)
  }

  @MainActor
  func testTaskSelectionRetainsItsParentWhenReturningToCompactNavigation() {
    let navigation = AppNavigation()
    navigation.openIncident("incident-a")
    navigation.browse.selection = .task(id: "task-a", incidentID: "incident-a")

    // Changing top-level tabs must not discard the browser's current route.
    navigation.section = .account
    navigation.browse.updatePresentedPath([])
    navigation.browse.selectPresentedRow(nil)
    navigation.section = .incidents
    XCTAssertEqual(navigation.browse.selection?.taskID, "task-a")
    // The compact stack's back action returns to the event, then to the list.
    navigation.browse.path.removeLast()
    XCTAssertEqual(navigation.browse.selection, .incident("incident-a"))
    navigation.browse.path.removeLast()
    XCTAssertNil(navigation.browse.selection)
  }

  @MainActor
  private func makeModel(
    handler: @escaping @MainActor (TaskDetailURLProtocol) -> Void
  ) -> (AppModel, URLSession) {
    TaskDetailURLProtocol.handler = handler
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [TaskDetailURLProtocol.self]
    let session = URLSession(configuration: configuration)
    return (AppModel(session: session), session)
  }
}

private final class TaskDetailURLProtocol: URLProtocol {
  @MainActor static var handler: ((TaskDetailURLProtocol) -> Void)?

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Task { @MainActor in Self.handler?(self) }
  }
  override func stopLoading() {}

  func respond(id: String) {
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200,
      httpVersion: nil, headerFields: nil)!
    let body = """
      {"id":"\(id)","incidentId":"incident-a","title":"Task","summary":"Details",
       "status":"open","updatedAt":"2026-11-03T00:00:00Z",
       "organizer":{"id":"organizer","name":"Organizer","verified":true,"contacts":[]},
       "blocks":[],"requiredFields":[],"contactFields":[]}
      """
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
}
