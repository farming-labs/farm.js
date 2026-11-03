import UIKit

/// The shell's colors, light and dark. The same values as the Android shell's colors.xml.
enum Theme {
    static let background = dynamic(light: 0xF7F8F6, dark: 0x111312)
    static let surface = dynamic(light: 0xFFFFFF, dark: 0x1B1E1C)
    static let accent = dynamic(light: 0x2F6F4F, dark: 0x7FC8A0)
    static let text = dynamic(light: 0x1A1D1B, dark: 0xE8EBE9)

    private static func dynamic(light: UInt32, dark: UInt32) -> UIColor {
        UIColor { traits in rgb(traits.userInterfaceStyle == .dark ? dark : light) }
    }

    private static func rgb(_ value: UInt32) -> UIColor {
        UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}
