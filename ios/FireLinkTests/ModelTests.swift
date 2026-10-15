import XCTest

@testable import FireLink

final class ModelTests: XCTestCase {
  func testSharedApplicationContractPreservesDisclosureStates() throws {
    let url = try XCTUnwrap(
      Bundle(for: Self.self).url(forResource: "application-results", withExtension: "json"))
    let records = try JSONDecoder().decode([Application].self, from: Data(contentsOf: url))
    XCTAssertEqual(
      records.map(\.statusLabel),
      [
        "application_pending", "application_accepted", "application_rejected",
        "application_withdrawn",
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
