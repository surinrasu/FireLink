import UserNotifications

/// Local transport used only when the server supplies development authentication data.
final class LocalNotifications: NSObject, UNUserNotificationCenterDelegate {
  static let shared = LocalNotifications()
  private let center = UNUserNotificationCenter.current()
  private override init() {
    super.init()
    center.delegate = self
  }
  func prepare() async throws {
    let allowed = try await center.requestAuthorization(options: [.alert, .sound])
    guard allowed else {
      throw ServiceError(message: L10n.text("notification_permission_settings"))
    }
  }
  func send(id: String, title: String, body: String) async throws {
    try await prepare()
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    // Immediate delivery; a stable identifier replaces an older code in Notification Center.
    center.removeDeliveredNotifications(withIdentifiers: [id])
    try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
  }
  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }
}
