import SwiftUI

struct OrganizerContactsView: View {
  let organizer: Organizer
  @Environment(\.dismiss) var dismiss
  @Environment(\.openURL) var openURL
  @State private var copied: String?
  @State private var failed = false
  var body: some View {
    List {
      Section { Text(organizer.name).font(.headline) }
      ForEach(Array(organizer.contacts.enumerated()), id: \.offset) { _, contact in
        Section(contact.label) {
          Text(contact.value).textSelection(.enabled)
          if let url = contactURL(contact) {
            Button(contact.type == "phone" ? L10n.text("call_phone") : L10n.text("send_email")) {
              openURL(url) { accepted in if !accepted { failed = true } }
            }
          }
          Button(
            copied == contact.value
              ? L10n.text("copied")
              : contact.type == "wechat" ? L10n.text("copy_wechat") : L10n.text("copy")
          ) {
            PlatformSupport.copy(contact.value)
            copied = contact.value
          }
        }
      }
    }.navigationTitle(L10n.text("contact_organizer")).inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button(L10n.text("done")) { dismiss() } }
      }
      .alert(L10n.text("no_contact_app"), isPresented: $failed) {
        Button(L10n.text("ok"), role: .cancel) {}
      }
  }
  func contactURL(_ contact: OrganizerContact) -> URL? {
    guard ["phone", "email"].contains(contact.type) else { return nil }
    var url = URLComponents()
    url.scheme = contact.type == "phone" ? "tel" : "mailto"
    url.path = contact.value
    return url.url
  }
}
