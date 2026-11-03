import SwiftUI

#if os(macOS)
  import AppKit
#else
  import UIKit
#endif

enum PlatformSupport {
  static var groupedBackground: Color {
    #if os(macOS)
      Color(nsColor: .windowBackgroundColor)
    #else
      Color(uiColor: .systemGroupedBackground)
    #endif
  }

  static var contentBackground: Color {
    #if os(macOS)
      Color(nsColor: .controlBackgroundColor)
    #else
      Color(uiColor: .secondarySystemGroupedBackground)
    #endif
  }

  static var secondaryBackground: Color {
    #if os(macOS)
      Color(nsColor: .underPageBackgroundColor)
    #else
      Color(uiColor: .secondarySystemBackground)
    #endif
  }

  @MainActor static func copy(_ value: String) {
    #if os(macOS)
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(value, forType: .string)
    #else
      UIPasteboard.general.string = value
    #endif
  }
}

enum InputPurpose {
  case phone, verificationCode, email, identifier, identityNumber
}

extension View {
  @ViewBuilder func inlineNavigationTitle() -> some View {
    #if os(macOS)
      self
    #else
      navigationBarTitleDisplayMode(.inline)
    #endif
  }

  @ViewBuilder func inputPurpose(_ purpose: InputPurpose) -> some View {
    #if os(macOS)
      autocorrectionDisabled()
    #else
      switch purpose {
      case .phone:
        keyboardType(.phonePad)
      case .verificationCode:
        keyboardType(.numberPad)
      case .email:
        keyboardType(.emailAddress).textInputAutocapitalization(.never)
      case .identifier:
        textInputAutocapitalization(.never).autocorrectionDisabled()
      case .identityNumber:
        textInputAutocapitalization(.characters).autocorrectionDisabled()
      }
    #endif
  }

  /// Mac sheets need an explicit useful size; iPad and visionOS use system presentation sizing.
  @ViewBuilder func volunteerSheet() -> some View {
    #if os(macOS)
      frame(minWidth: 480, idealWidth: 560, minHeight: 460, idealHeight: 620)
        .formStyle(.grouped)
    #else
      self
    #endif
  }

  /// Keep reading content comfortable when the surrounding window grows.
  func readableContent() -> some View {
    frame(maxWidth: 820, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .center)
  }
}
