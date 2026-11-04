import XCTest

@testable import FireLink

final class ModelTests: XCTestCase {
  func testMapAnnotationsPreserveLegacyAndMultipleGeometries() throws {
    let url = try XCTUnwrap(
      Bundle(for: Self.self).url(forResource: "map-annotations", withExtension: "json"))
    let blocks = try JSONDecoder().decode([ContentBlock].self, from: Data(contentsOf: url))
    XCTAssertNil(blocks[0].annotations)
    XCTAssertEqual(blocks[0].latitude, 30.25)
    XCTAssertEqual(blocks[1].annotations?.map(\.type), ["point", "point", "path", "area"])
    XCTAssertEqual(blocks[1].annotations?.map { $0.coordinates.count }, [1, 1, 2, 3])
    let restored = try JSONDecoder().decode([ContentBlock].self, from: JSONEncoder().encode(blocks))
    XCTAssertEqual(restored, blocks)
  }
  func testVehiclesAndEquipmentPreserveLegacyTextAndRoundTrip() throws {
    let legacy =
      #"{"id":"test","username":"Test","pronouns":"","realName":"Test","birthDate":"2000-01-01","gender":"","verified":true,"region":"","body":"","equipment":["vehicle"],"contacts":{"phone":"13800000000","wechat":"","email":""}}"#
    var profile = try JSONDecoder().decode(Profile.self, from: Data(legacy.utf8))
    XCTAssertNil(profile.equipmentDetails)
    profile.equipmentDetails = ["vehiclePassengers": "4 人", "vehicleCargo": "500 升"]
    XCTAssertTrue(profile.equipmentText.contains("4 人"))
    XCTAssertTrue(profile.equipmentText.contains("500 升"))
    XCTAssertNil(profile.vehicles)
    profile.equipmentDescription = "帐篷、手套\n任意内容"
    profile.vehicles = ["motorcycle": 2, "sedan": 1]
    let restored = try JSONDecoder().decode(Profile.self, from: JSONEncoder().encode(profile))
    XCTAssertEqual(restored.equipmentDetails, profile.equipmentDetails)
    XCTAssertEqual(restored.equipmentText, "帐篷、手套\n任意内容")
    XCTAssertEqual(restored.vehicles, profile.vehicles)
    profile.equipmentDescription = ""
    XCTAssertEqual(profile.equipmentText, "")
  }
  func testSharedApplicationContractPreservesDisclosureStates() throws {
    let url = try XCTUnwrap(
      Bundle(for: Self.self).url(forResource: "application-results", withExtension: "json"))
    let records = try JSONDecoder().decode([Application].self, from: Data(contentsOf: url))
    XCTAssertEqual(
      records.map(\.statusLabel),
      [
        "application_pending", "application_accepted", "application_rejected",
        "application_withdrawn", "application_expired",
      ].map { L10n.text($0) })
    XCTAssertEqual(records.filter(\.contactsReleased).map(\.status), ["accepted"])
    XCTAssertEqual(records.first?.contactFields, ["phone"])
    XCTAssertNil(records.first?.response)
    XCTAssertNotNil(records[1].response)
  }
  func testSortingCountsOnlyOpenTasksAndBreaksTiesConsistently() throws {
    let url = try XCTUnwrap(
      Bundle(for: Self.self).url(forResource: "incident-sorting", withExtension: "json"))
    let incidents = try JSONDecoder().decode([Incident].self, from: Data(contentsOf: url))
    XCTAssertEqual(
      IncidentSort.updated.apply(incidents).map(\.id),
      ["incident-closed", "incident-hangzhou", "incident-nanjing"])
    XCTAssertEqual(IncidentSort.oldest.apply(incidents).first?.id, "incident-nanjing")
    XCTAssertEqual(
      IncidentSort.recruiting.apply(incidents).map(\.id),
      ["incident-hangzhou", "incident-nanjing", "incident-closed"])
  }
}
