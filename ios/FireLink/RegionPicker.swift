import SwiftUI

struct RegionNode: Decodable, Identifiable {
  let code: String
  let name: String
  let children: [RegionNode]?
  var id: String { code }
}

struct RegionCatalog {
  let provinces: [RegionNode]

  static let shared: RegionCatalog = {
    let url = Bundle.main.url(forResource: "regions", withExtension: "json")!
    return RegionCatalog(
      provinces: try! JSONDecoder().decode([RegionNode].self, from: Data(contentsOf: url)))
  }()

  static func normalized(_ value: String) -> String {
    value.components(separatedBy: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "/／")))
      .joined()
  }

  func selection(for region: String) -> [RegionNode] {
    var remaining = Self.normalized(region)
    var options = provinces
    var selected: [RegionNode] = []
    while let node = options.first(where: { remaining.hasPrefix($0.name) }) {
      selected.append(node)
      remaining.removeFirst(node.name.count)
      options = node.children ?? []
    }
    return selected
  }

  func replacing(_ region: String, level: Int, with node: RegionNode?) -> String {
    (Array(selection(for: region).prefix(level)) + (node.map { [$0] } ?? []))
      .map(\.name).joined(separator: " ")
  }
}

struct RegionPicker: View {
  @Binding var region: String
  private let catalog = RegionCatalog.shared
  private let labels = ["region_province", "region_city", "region_district"]
  private var selected: [RegionNode] { catalog.selection(for: region) }

  var body: some View {
    ForEach(0..<3, id: \.self) { level in
      let options =
        level == 0
        ? catalog.provinces : (selected.count >= level ? selected[level - 1].children ?? [] : [])
      Picker(
        L10n.text(labels[level]),
        selection: Binding(
          get: { selected.count > level ? selected[level].code : "" },
          set: { code in
            region = catalog.replacing(
              region, level: level, with: options.first { $0.code == code })
          }
        )
      ) {
        Text(L10n.text(level == 0 ? "not_provided" : "region_any")).tag("")
        ForEach(options) { node in Text(node.name).tag(node.code) }
      }
      .pickerStyle(.menu)
      .disabled(options.isEmpty)
      .accessibilityIdentifier(labels[level])
    }
    // Keep free-text regions from older app versions until the user chooses a replacement.
    if RegionCatalog.normalized(region) != RegionCatalog.normalized(selected.map(\.name).joined()) {
      Text(L10n.text("region_existing", region)).font(.caption).foregroundStyle(.secondary)
      Button(L10n.text("region_clear")) { region = "" }
    }
  }
}
