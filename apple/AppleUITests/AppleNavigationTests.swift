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
    XCTAssertTrue(copy.waitForExistence(timeout: 5))
    activate(copy)
    XCTAssertTrue(app.buttons["Copied"].waitForExistence(timeout: 5))
    capture(app, name: "apple-contacts")
    activate(app.buttons["Done"])

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
    #if os(macOS)
      activate(element("section-" + section, in: app))
    #else
      let sidebar = app.staticTexts["section-" + section]
      if sidebar.exists && sidebar.isHittable {
        activate(sidebar)
      } else {
        activate(app.tabBars.buttons[title])
      }
    #endif
  }

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
