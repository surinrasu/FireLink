import XCTest

/// Opt-in staging smoke test: `mise -C apple run test:demo`.
final class CloudDemoTests: XCTestCase {
  func testEnterDemoClient() throws {
    let app = XCUIApplication()
    app.launchArguments += [
      "--demo-ui-test", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN",
    ]
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["我的"].waitForExistence(timeout: 15))
    app.tabBars.buttons["我的"].tap()
    let demo = app.buttons["进入演示客户端"]
    XCTAssertTrue(demo.waitForExistence(timeout: 30))
    capture(app, name: "cloud-demo-login")
    demo.tap()
    XCTAssertTrue(demo.waitForNonExistence(timeout: 30))
    XCTAssertTrue(app.tabBars.buttons["首页"].waitForExistence(timeout: 30))
    XCTAssertFalse(app.alerts.firstMatch.exists)
    app.tabBars.buttons["我的"].tap()
    XCTAssertTrue(app.staticTexts["林小满"].waitForExistence(timeout: 15))
    capture(app, name: "cloud-demo-account")
    app.buttons["设置"].tap()
    app.buttons["退出登录"].tap()
    app.navigationBars.buttons["我的"].tap()
    XCTAssertTrue(app.buttons["登录 / 注册"].waitForExistence(timeout: 15))
    app.terminate()
  }

  private func capture(_ app: XCUIApplication, name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
