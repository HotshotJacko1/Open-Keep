import SwiftUI
import UIKit

/// Home-screen widget colours: the app's own theme tokens (src/globals.css),
/// with a light and a dark value each, so the widgets look like the app.
/// Android uses the same values in res/values/widget_colors.xml and
/// res/values-night/widget_colors.xml; change all three together.
enum WidgetPalette {
    /// background: the app's page colour.
    static let background = dynamic(light: 0xFCEADE, dark: 0x221811)
    /// foreground: widget titles.
    static let heading = dynamic(light: 0x201B18, dark: 0xEBE6E0)
    /// secondary-foreground: text on note cards.
    static let textPrimary = dynamic(light: 0x211E1C, dark: 0xEDEBE8)
    /// muted-foreground: previews, counts and hints.
    static let textSecondary = dynamic(light: 0x70645C, dark: 0xB0A59B)
    /// foreground: checklist items and note text.
    static let textList = dynamic(light: 0x201B18, dark: 0xEBE6E0)
    /// foreground at 70%: checked items, which are also struck through as in the app.
    static let textChecked = dynamic(light: 0x201B18, dark: 0xEBE6E0, alpha: 0.7)
    /// secondary: the app's unselected-icon colour.
    static let icon = dynamic(light: 0x78726D, dark: 0x9E9894)
    /// outline-variant: dividers.
    static let divider = dynamic(light: 0xDED5CE, dark: 0x534B46)
    /// card: note cards.
    static let card = dynamic(light: 0xFFF8F5, dark: 0x1A1614)
    /// outline-variant: note card outline.
    static let cardStroke = dynamic(light: 0xDED5CE, dark: 0x534B46)
    /// muted-foreground: unchecked box.
    static let checkbox = dynamic(light: 0x70645C, dark: 0xB0A59B)
    /// success: checked tick.
    static let check = dynamic(light: 0x157F3C, dark: 0x4ADE80)
    /// highlight: the pinned icon.
    static let highlight = dynamic(light: 0xFFBE00, dark: 0xFFBE00)

    private static func dynamic(light: UInt32, dark: UInt32, alpha: CGFloat = 1) -> Color {
        Color(uiColor: UIColor { traits in
            rgb(traits.userInterfaceStyle == .dark ? dark : light, alpha: alpha)
        })
    }

    private static func rgb(_ hex: UInt32, alpha: CGFloat) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}
