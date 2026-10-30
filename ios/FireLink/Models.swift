import Foundation

struct ContentBlock: Codable, Hashable {
  let type: String
  var text: String?
  var url: String?
  var rows: [[String]]?
  var latitude: Double?
  var longitude: Double?
  var annotations: [MapAnnotation]?
}
struct MapCoordinate: Codable, Hashable {
  let latitude: Double
  let longitude: Double
}
struct MapAnnotation: Codable, Hashable {
  let type: String
  let coordinates: [MapCoordinate]
}
struct Organizer: Codable {
  let id: String
  let name: String
  let verified: Bool
  let contacts: [OrganizerContact]
}
struct OrganizerContact: Codable, Hashable {
  let type: String
  let label: String
  let value: String
}
struct IdentityExample: Codable {
  let realName: String
  let idNumber: String
}
struct TaskSummary: Codable, Identifiable, Hashable {
  let id: String
  let incidentId: String
  let title: String
  let summary: String
  let status: String
  let updatedAt: String
}
struct Incident: Codable, Identifiable {
  let id: String
  let title: String
  let region: String
  let latitude: Double
  let longitude: Double
  let status: String
  let updatedAt: String
  let tasks: [TaskSummary]
}
struct RescueTask: Codable, Identifiable {
  let id: String
  let incidentId: String
  let title: String
  let summary: String
  let status: String
  let updatedAt: String
  let organizer: Organizer
  let blocks: [ContentBlock]
  let requiredFields: [String]
  let contactFields: [String]
}
struct Article: Codable, Identifiable {
  let id: String
  let title: String
  let summary: String
  let category: String
  let minutes: Int
  let blocks: [ContentBlock]
}
struct Contacts: Codable {
  var phone: String
  var wechat: String
  var email: String
}
struct Profile: Codable {
  var id: String
  var username: String
  var pronouns: String
  var realName: String
  var birthDate: String
  var gender: String
  var verified: Bool
  var region: String
  var body: String
  var equipment: [String]
  var equipmentDetails: [String: String]?
  var equipmentDescription: String?
  var vehicles: [String: Int]?
  var contacts: Contacts
  var equipmentText: String {
    if let equipmentDescription { return equipmentDescription }
    return equipment.map { key in
      let fields = key == "vehicle" ? ["vehiclePassengers", "vehicleCargo"] : [key]
      let text = fields.compactMap { equipmentDetails?[$0] }.filter { !$0.isEmpty }.joined(
        separator: "；")
      let label = legacyEquipmentLabels[key] ?? key
      return text.isEmpty ? label : "\(label)：\(text)"
    }.joined(separator: "\n")
  }
  var age: Int {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
    let parts = birthDate.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3,
      let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    else { return 0 }
    return calendar.dateComponents([.year], from: date, to: Date()).year ?? 0
  }
}
struct Credential: Codable, Identifiable {
  let id: String
  let title: String
  let filename: String
  let status: String
  let createdAt: String
}
struct Application: Codable, Identifiable {
  let id: String
  let taskId: String
  let taskTitle: String
  let organizerName: String
  let status: String
  let contactFields: [String]
  let contactsReleased: Bool
  let createdAt: String
  let updatedAt: String
  let response: String?
  var statusLabel: String {
    [
      "pending": L10n.text("application_pending"), "accepted": L10n.text("application_accepted"),
      "rejected": L10n.text("application_rejected"),
      "withdrawn": L10n.text("application_withdrawn"),
    ][status] ?? status
  }
}
struct Notice: Codable, Identifiable {
  let id: String
  let title: String
  let body: String
  let applicationId: String?
  let createdAt: String
  var readAt: String?
}
struct ServerConfig: Codable {
  let mockAuth: Bool
  let passkeys: Bool
  let region: String
  let consentVersion: Int
  let mockIdentity: IdentityExample?
}
struct AuthResult: Codable {
  let token: String?
  let profile: Profile?
  let registrationToken: String?
  let needsRegistration: Bool?
}
struct SMSResult: Codable {
  let challengeId: String
  let mockCode: String?
  let message: String
}
struct OK: Codable { let ok: Bool }
struct CreatedApplication: Codable {
  let id: String
  let status: String
}
var fieldLabels: [String: String] {
  [
    "username": L10n.text("username"), "pronouns": L10n.text("pronouns"),
    "realName": L10n.text("real_name"), "age": L10n.text("age"), "gender": L10n.text("gender"),
    "region": L10n.text("region"), "body": L10n.text("physical_information"),
    "equipment": L10n.text("equipment"), "vehicles": L10n.text("vehicles"),
    "skills": L10n.text("skills"), "phone": L10n.text("phone"),
    "wechat": L10n.text("wechat"), "email": L10n.text("email"),
  ]
}
private var legacyEquipmentLabels: [String: String] {
  [
    "vehicle": L10n.text("vehicle"), "firstAid": L10n.text("first_aid"),
    "protective": L10n.text("protective_equipment"), "tools": L10n.text("tools"),
  ]
}

let vehicleTypes = [
  ("motorcycle", "vehicle_motorcycle"), ("cargoTricycle", "vehicle_cargo_tricycle"),
  ("sedan", "vehicle_sedan"), ("offRoad", "vehicle_off_road"), ("cargoVan", "vehicle_cargo_van"),
]

enum IncidentSort: String, CaseIterable, Identifiable {
  case updated = "sort_updated"
  case oldest = "sort_oldest"
  case recruiting = "sort_recruiting"
  var id: String { rawValue }
  var label: String { L10n.text(rawValue) }
  func apply(_ incidents: [Incident]) -> [Incident] {
    incidents.sorted { a, b in
      if self == .recruiting {
        let left = a.tasks.filter { $0.status == "open" }.count
        let right = b.tasks.filter { $0.status == "open" }.count
        if left != right { return left > right }
      }
      if a.updatedAt != b.updatedAt {
        return self == .oldest ? a.updatedAt < b.updatedAt : a.updatedAt > b.updatedAt
      }
      return a.id < b.id
    }
  }
}
