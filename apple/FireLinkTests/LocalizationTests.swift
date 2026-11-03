import XCTest

@testable import FireLink

final class LocalizationTests: XCTestCase {
  func testDatesUseSystemFormattingIncludingFractionalServerTimestamps() {
    let timestamp = "2026-10-15T03:00:00Z"
    let formatter = DateFormatter()
    formatter.locale = .autoupdatingCurrent
    formatter.timeZone = .autoupdatingCurrent
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    let expected = formatter.string(from: ISO8601DateFormatter().date(from: timestamp)!)
    XCTAssertEqual(displayDate(timestamp), expected)
    XCTAssertEqual(displayDate("2026-10-15T03:00:00.123Z"), expected)
  }

  func testSystemLanguageMatching() throws {
    let cases = [
      ("en-US", "en"), ("en-GB", "en"), ("zh-CN", "zh-Hans"),
      ("zh-SG", "zh-Hans"), ("zh-Hans", "zh-Hans"),
      ("zh-TW", "zh-Hant"), ("zh-Hant", "zh-Hant"),
      ("zh-HK", "zh-Hant-HK"), ("zh-MO", "zh-Hant-HK"),
      ("zh-Hans-HK", "zh-Hans"), ("fr-FR", "en"),
    ]
    for (preference, expected) in cases {
      let matched = Bundle.preferredLocalizations(
        from: Bundle.main.localizations, forPreferences: [preference])
      XCTAssertEqual(matched.first, expected, preference)
    }
    XCTAssertEqual(
      Bundle.preferredLocalizations(
        from: Bundle.main.localizations, forPreferences: ["fr-FR", "zh-TW", "en"]
      ).first,
      "zh-Hant")
  }

  func testTranslationsAndFormattedNotifications() throws {
    for (language, login, passkeys) in [
      ("en", "Sign in", "Passkeys"),
      ("zh-Hans", "登录", "通行密钥"),
      ("zh-Hant", "登入", "通行金鑰"),
      ("zh-Hant-HK", "登入", "通行密鑰"),
    ] {
      let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"))
      let bundle = try XCTUnwrap(Bundle(path: path))
      XCTAssertEqual(L10n.text("sign_in", bundle: bundle), login)
      XCTAssertEqual(L10n.text("passkeys", bundle: bundle), passkeys)
      let notification = L10n.text("identity_notification", "Alex", "123456", bundle: bundle)
      XCTAssertTrue(notification.contains("Alex"))
      XCTAssertTrue(notification.contains("123456"))
      XCTAssertTrue(notification.contains("\n"))
      XCTAssertFalse(notification.contains("%@"))
      XCTAssertTrue(L10n.text("unread_count", 12, bundle: bundle).contains("12"))
    }
  }
}
