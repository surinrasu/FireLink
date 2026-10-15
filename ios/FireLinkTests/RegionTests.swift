import XCTest

@testable import FireLink

final class RegionTests: XCTestCase {
  let catalog = RegionCatalog.shared

  func testBundledRegionsAndExistingValues() throws {
    XCTAssertEqual(catalog.provinces.count, 31)
    XCTAssertTrue(catalog.provinces.allSatisfy { !($0.children ?? []).isEmpty })
    for region in ["浙江省 杭州市 西湖区", "浙江省/杭州市/西湖区", "浙江省杭州市西湖区"] {
      XCTAssertEqual(catalog.selection(for: region).map(\.code), ["33", "3301", "330106"])
    }
    XCTAssertEqual(catalog.selection(for: "北京市 市辖区 东城区").last?.code, "110101")
    XCTAssertEqual(catalog.selection(for: "海南省 省直辖县级行政区划 琼海市").last?.code, "469002")
    XCTAssertTrue(catalog.selection(for: "Hangzhou").isEmpty)
    XCTAssertTrue(catalog.selection(for: "").isEmpty)
  }

  func testChangingParentClearsDescendants() throws {
    let original = "浙江省 杭州市 西湖区"
    let jiangsu = try XCTUnwrap(catalog.provinces.first { $0.name == "江苏省" })
    XCTAssertEqual(catalog.replacing(original, level: 0, with: jiangsu), "江苏省")
    let zhejiang = try XCTUnwrap(catalog.provinces.first { $0.name == "浙江省" })
    let ningbo = try XCTUnwrap(zhejiang.children?.first { $0.name == "宁波市" })
    XCTAssertEqual(catalog.replacing(original, level: 1, with: ningbo), "浙江省 宁波市")
    XCTAssertEqual(catalog.replacing(original, level: 2, with: nil), "浙江省 杭州市")
    XCTAssertEqual(catalog.replacing(original, level: 0, with: nil), "")
    XCTAssertEqual(catalog.replacing("Hangzhou", level: 0, with: jiangsu), "江苏省")
  }
}
