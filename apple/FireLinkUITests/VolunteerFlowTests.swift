import XCTest

final class VolunteerFlowTests: XCTestCase {
  func testRepeatedPullToRefreshDoesNotShowCancellationAlert() throws {
    let app = XCUIApplication()
    app.launchArguments += ["--ui-test", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
    app.launch()
    XCTAssertTrue(app.buttons["incident-incident-hangzhou"].waitForExistence(timeout: 15))

    for tab in ["首页", "状况"] {
      app.tabBars.buttons[tab].tap()
      for attempt in 1...3 {
        let scroll = app.scrollViews.firstMatch
        let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2))
        let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
        start.press(forDuration: 0.1, thenDragTo: end)
        let hasAlert = app.alerts.firstMatch.waitForExistence(timeout: 3)
        XCTAssertFalse(hasAlert, "\(tab), refresh \(attempt)")
        if hasAlert { return }
        XCTAssertTrue(app.buttons["incident-incident-hangzhou"].exists)
      }
    }
  }

  func testSystemLanguageChangesInterface() throws {
    for (language, home, incidents, account) in [
      ("en", "Home", "Incidents", "Account"),
      ("zh-Hans", "首页", "状况", "我的"),
      ("zh-Hant-TW", "首頁", "狀況", "我的"),
      ("zh-Hant-HK", "首頁", "狀況", "我的"),
    ] {
      let app = XCUIApplication()
      app.launchArguments += ["--ui-test", "-AppleLanguages", "(\(language))"]
      app.launch()
      XCTAssertTrue(app.tabBars.buttons[home].waitForExistence(timeout: 10), language)
      XCTAssertTrue(app.tabBars.buttons[incidents].exists, language)
      XCTAssertTrue(app.tabBars.buttons[account].exists, language)
      let screenshot = XCTAttachment(screenshot: app.screenshot())
      screenshot.name = "system-language-\(language)"
      screenshot.lifetime = .keepAlways
      add(screenshot)
      app.terminate()
    }
  }

  func testBrowseSortingAndContactChoices() throws {
    let app = XCUIApplication()
    app.launchArguments += ["--ui-test", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["状况"].waitForExistence(timeout: 15))
    app.tabBars.buttons["状况"].tap()
    let sort = app.buttons["incident-sort"]
    XCTAssertTrue(sort.waitForExistence(timeout: 5))
    sort.tap()
    app.buttons["按最早更新"].tap()
    XCTAssertTrue(sort.label.contains("按最早更新"))
    sort.tap()
    app.buttons["按最近更新"].tap()
    let incident = app.buttons["incident-incident-hangzhou"]
    XCTAssertTrue(incident.waitForExistence(timeout: 5))
    incident.tap()
    app.buttons["task-task-supply"].tap()
    let contact = app.buttons["联系发布者"]
    XCTAssertTrue(contact.waitForExistence(timeout: 10))
    contact.tap()
    XCTAssertTrue(app.buttons["拨打电话"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["发送邮件"].exists)
    app.buttons["复制微信号"].tap()
    XCTAssertTrue(app.buttons["已复制"].exists)
  }
  func testRegisterEditRegionAndApply() throws {
    let app = XCUIApplication()
    app.launchArguments += ["--ui-test", "-AppleLanguages", "(zh-Hans)", "-AppleLocale", "zh_CN"]
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["我的"].waitForExistence(timeout: 15))
    XCTAssertFalse(app.buttons["notification-history"].exists)
    app.tabBars.buttons["我的"].tap()
    let phone = app.textFields["中国大陆手机号"]
    XCTAssertTrue(phone.waitForExistence(timeout: 5))
    phone.tap()
    phone.typeText("139" + String(Int(Date().timeIntervalSince1970) % 100_000_000))
    app.buttons["获取验证码"].tap()
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let allow = springboard.buttons.matching(NSPredicate(format: "label IN %@", ["Allow", "允许"]))
      .firstMatch
    if allow.waitForExistence(timeout: 3) { allow.tap() }
    let message = springboard.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "验证码："))
      .firstMatch
    XCTAssertTrue(message.waitForExistence(timeout: 10))
    // Read the received notification rather than exposing the code inside the app.
    let range = try XCTUnwrap(message.label.range(of: "[0-9]{6}", options: .regularExpression))
    let receivedCode = String(message.label[range])
    app.textFields["6 位验证码"].tap()
    app.textFields["6 位验证码"].typeText(receivedCode)
    app.buttons["验证并继续"].tap()
    let name = app.textFields["姓名"]
    XCTAssertTrue(name.waitForExistence(timeout: 10))
    let identity = springboard.staticTexts.matching(
      NSPredicate(format: "label CONTAINS %@", "身份证号：")
    ).firstMatch
    XCTAssertTrue(identity.waitForExistence(timeout: 10))
    XCTAssertTrue(identity.label.contains("林晓"))
    let idRange = try XCTUnwrap(identity.label.range(of: "[0-9]{18}", options: .regularExpression))
    let identityNumber = String(identity.label[idRange])
    name.tap()
    name.typeText("林晓")
    app.textFields["身份证号"].tap()
    app.textFields["身份证号"].typeText(identityNumber)
    let consent = app.switches["同意创建账号并进行实名认证"]
    XCTAssertTrue(consent.waitForExistence(timeout: 10))
    if !consent.isHittable { app.swipeUp() }
    consent.switches.firstMatch.tap()
    app.buttons["注册并实名认证"].tap()
    let notifications = app.buttons["notification-history"]
    XCTAssertTrue(notifications.waitForExistence(timeout: 10))
    notifications.tap()
    XCTAssertTrue(app.navigationBars["通知历史"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["暂无通知"].waitForExistence(timeout: 5))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.tabBars.buttons["我的"].tap()
    app.buttons["设置"].tap()
    app.buttons["通行密钥"].tap()
    XCTAssertTrue(app.buttons["添加通行密钥"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["尚未添加通行密钥"].waitForExistence(timeout: 5))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons["个人信息"].waitForExistence(timeout: 10))
    app.buttons["个人信息"].tap()
    let province = app.buttons["region_province"]
    XCTAssertTrue(province.waitForExistence(timeout: 5))
    XCTAssertFalse(app.textFields["大致身体状况、体力或活动限制"].exists)
    province.tap()
    let zhejiang = app.buttons["浙江省"]
    for _ in 0..<6 {
      if zhejiang.isHittable { break }
      app.swipeUp()
    }
    zhejiang.tap()
    app.buttons["region_city"].tap()
    app.buttons["杭州市"].tap()
    app.buttons["region_district"].tap()
    app.buttons["西湖区"].tap()
    for key in ["motorcycle", "cargoTricycle", "sedan", "offRoad", "cargoVan"] {
      let plus = app.buttons["vehicle-plus-\(key)"]
      let minus = app.buttons["vehicle-minus-\(key)"]
      for _ in 0..<6 {
        if plus.isHittable { break }
        app.swipeUp()
      }
      XCTAssertFalse(minus.isEnabled)
      plus.tap()
      plus.tap()
      minus.tap()
      XCTAssertEqual(app.staticTexts["vehicle-count-\(key)"].label, "1")
    }
    let equipment = app.descendants(matching: .any).matching(identifier: "equipment-description")
      .firstMatch
    for _ in 0..<6 {
      if equipment.isHittable { break }
      app.swipeUp()
    }
    equipment.tap()
    equipment.typeText("Jack, gloves, any supplies\nFree-form notes")
    let profileScreenshot = XCTAttachment(screenshot: app.screenshot())
    profileScreenshot.name = "profile-region-dropdowns"
    profileScreenshot.lifetime = .keepAlways
    add(profileScreenshot)
    app.buttons["保存"].tap()
    for _ in 0..<5 {
      if app.staticTexts["已保存"].exists { break }
      app.swipeUp()
    }
    XCTAssertTrue(app.staticTexts["已保存"].waitForExistence(timeout: 5))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["个人信息"].tap()
    for key in ["motorcycle", "cargoTricycle", "sedan", "offRoad", "cargoVan"] {
      let count = app.staticTexts["vehicle-count-\(key)"]
      for _ in 0..<6 {
        if count.exists { break }
        app.swipeUp()
      }
      XCTAssertEqual(count.label, "1")
    }
    let restoredEquipment = app.descendants(matching: .any).matching(
      identifier: "equipment-description"
    ).firstMatch
    for _ in 0..<6 {
      if restoredEquipment.exists { break }
      app.swipeUp()
    }
    XCTAssertEqual(
      restoredEquipment.value as? String, "Jack, gloves, any supplies\nFree-form notes")
    let equipmentScreenshot = XCTAttachment(screenshot: app.screenshot())
    equipmentScreenshot.name = "vehicles-and-equipment"
    equipmentScreenshot.lifetime = .keepAlways
    add(equipmentScreenshot)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.tabBars.buttons["状况"].tap()
    let incident = app.buttons["incident-incident-hangzhou"]
    XCTAssertTrue(incident.waitForExistence(timeout: 5))
    incident.tap()
    let task = app.buttons["task-task-supply"]
    XCTAssertTrue(task.waitForExistence(timeout: 5))
    task.tap()
    XCTAssertTrue(app.buttons["报名参与"].waitForExistence(timeout: 10))
    app.buttons["报名参与"].tap()
    let authorization = app.switches["我确认以上资料选择与联系方式授权"]
    for _ in 0..<4 {
      if authorization.isHittable { break }
      app.swipeUp()
    }
    XCTAssertTrue(authorization.waitForExistence(timeout: 5))
    authorization.switches.firstMatch.tap()
    app.buttons["确认报名"].tap()
    XCTAssertTrue(app.buttons["已报名 · 查看记录"].waitForExistence(timeout: 10))
    app.buttons["已报名 · 查看记录"].tap()
    XCTAssertTrue(
      app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "待审核"))
        .firstMatch.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["联系方式尚未开放"].exists)
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.name = "报名成功"
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}
