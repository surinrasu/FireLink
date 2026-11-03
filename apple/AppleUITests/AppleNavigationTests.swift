import XCTest

#if os(macOS)
  import AppKit
#else
  import UIKit
#endif

/// Run against the local seeded backend on iPhone, iPad, and Mac.
final class AppleNavigationTests: XCTestCase {
  override func tearDown() {
    XCUIApplication().terminate()
    super.tearDown()
  }

  func testBrowseContactsAndSignInAcrossNavigationLayouts() throws {
    continueAfterFailure = false
    var app = XCUIApplication()
    defer { app.terminate() }
    let server =
      ProcessInfo.processInfo.environment["FIRELINK_UI_TEST_SERVER"]
      ?? "http://localhost:8787"
    app.launchArguments += [
      "-AppleLanguages", "(en)", "-AppleLocale", "en_US",
    ]
    app.launchEnvironment["FIRELINK_UI_TEST_SERVER"] = server
    #if os(macOS)
      app.terminate()
      // Use Finder's open-application event so SwiftUI receives its initial window request.
      let applicationURL = URL(
        fileURLWithPath: try XCTUnwrap(
          ProcessInfo.processInfo.environment["FIRELINK_UI_TEST_APP_PATH"]))
      let configuration = NSWorkspace.OpenConfiguration()
      configuration.arguments = app.launchArguments
      configuration.environment = app.launchEnvironment
      let opened = expectation(description: "Open the Mac main window")
      NSWorkspace.shared.openApplication(at: applicationURL, configuration: configuration) {
        _, error in
        XCTAssertNil(error)
        opened.fulfill()
      }
      wait(for: [opened], timeout: 10)
      app = XCUIApplication(bundleIdentifier: "cn.firelink.volunteer")
      app.activate()
      XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
      resize(app.windows.firstMatch, width: 1100)
    #else
      app.launch()
    #endif

    let incident = element("incident-incident-hangzhou", in: app)
    let showsIncident = incident.waitForExistence(timeout: 20)
    capture(app, name: "apple-home")
    XCTAssertTrue(showsIncident, app.debugDescription)
    select("incidents", title: "Incidents", in: app)
    XCTAssertTrue(element("incident-sort", in: app).waitForExistence(timeout: 5))
    activate(incident)
    activate(element("task-task-supply", in: app))
    let contacts = app.buttons["Contact organizer"]
    XCTAssertTrue(contacts.waitForExistence(timeout: 10))
    activate(contacts)
    let copy = app.buttons["Copy WeChat ID"]
    XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
    activate(copy)
    XCTAssertTrue(app.buttons["Copied"].waitForExistence(timeout: 5))
    capture(app, name: "apple-contacts")
    activate(app.buttons["Done"])

    #if os(macOS)
      resize(app.windows.firstMatch, width: 760)
      XCTAssertTrue(contacts.waitForExistence(timeout: 5), app.debugDescription)
      capture(app, name: "apple-task-compact")
      select("home", title: "Home", in: app)
      select("incidents", title: "Incidents", in: app)
      XCTAssertTrue(contacts.waitForExistence(timeout: 5), app.debugDescription)
      activate(contacts)
      XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
      resize(app.windows.firstMatch, width: 1100)
      XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
      activate(app.buttons["Done"])
      XCTAssertTrue(contacts.waitForExistence(timeout: 5), app.debugDescription)
      capture(app, name: "apple-task-expanded")
    #else
      XCUIDevice.shared.orientation = .landscapeLeft
      XCTAssertTrue(contacts.waitForExistence(timeout: 5), app.debugDescription)
      XCUIDevice.shared.orientation = .portrait
      select("home", title: "Home", in: app)
      select("incidents", title: "Incidents", in: app)
      XCTAssertTrue(contacts.waitForExistence(timeout: 5), app.debugDescription)
    #endif

    select("account", title: "Account", in: app)
    let phone = app.textFields["sign-in-phone"]
    let showsPhone = phone.waitForExistence(timeout: 5)
    capture(app, name: "apple-sign-in")
    XCTAssertTrue(showsPhone, app.debugDescription)
    activate(app.buttons["Cancel"])
    XCTAssertTrue(app.buttons["Sign in / Register"].waitForExistence(timeout: 5))
    XCTAssertFalse(phone.exists)
    XCTAssertFalse(app.alerts.firstMatch.exists)
  }

  private func select(_ section: String, title: String, in app: XCUIApplication) {
    // Adaptive tabs can be top tabs, a sidebar, or bottom tabs; don't assume TabBar ancestry.
    let destination = element("section-" + section, in: app)
    if destination.exists && destination.isHittable {
      activate(destination)
    } else if app.buttons[title].firstMatch.exists {
      activate(app.buttons[title].firstMatch)
    } else {
      activate(app.staticTexts[title].firstMatch)
    }
  }

  #if os(macOS)
    private func resize(_ window: XCUIElement, width: CGFloat) {
      if abs(window.frame.width - width) <= 10 { return }
      let corner = window.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
        .withOffset(CGVector(dx: -2, dy: -2))
      let target = corner.withOffset(CGVector(dx: width - window.frame.width, dy: 0))
      corner.click(forDuration: 0.1, thenDragTo: target)
      // Allow drag variance; these sizes remain well clear of the column transition.
      XCTAssertEqual(window.frame.width, width, accuracy: 32)
    }
  #endif

  private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func activate(_ element: XCUIElement) {
    XCTAssertTrue(element.waitForExistence(timeout: 5))
    #if os(macOS)
      element.click()
    #else
      element.tap()
    #endif
  }

  private func capture(_ app: XCUIApplication, name: String) {
    #if os(macOS)
      // Keep native accessibility diagnostics without requiring desktop capture permissions.
      let attachment = XCTAttachment(string: app.debugDescription)
    #else
      let attachment = XCTAttachment(screenshot: app.screenshot())
    #endif
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
