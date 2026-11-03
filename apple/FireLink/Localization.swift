import Foundation

enum L10n {
  /// Bundle selects the best supported language from the system's preferences.
  static func text(_ key: String, _ arguments: Any..., bundle: Bundle = .main) -> String {
    let format = bundle.localizedString(forKey: key, value: nil, table: nil)
    guard !arguments.isEmpty else { return format }
    return String(
      format: format, locale: Locale.autoupdatingCurrent,
      arguments: arguments.map { String(describing: $0) })
  }

  static var language: String { Bundle.main.preferredLocalizations.first ?? "en" }

  static func gender(_ value: String) -> String {
    switch value {
    case "男": return text("gender_male")
    case "女": return text("gender_female")
    default: return value
    }
  }
}
