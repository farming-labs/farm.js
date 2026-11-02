import UIKit
import os

/// A native screen for a rule whose `screen` is `"native"` (`page.native.tsx`) or `"platform"`
/// (`page.swift`). The navigator shows its view controller instead of a WebView.
@MainActor
protocol FarmNativeScreen {
    func makeViewController(url: URL) -> UIViewController
}

/// Native screens by module id, such as `app/notes/[id]`. Farm does not build `page.native.tsx`
/// or `page.swift` screens into native views yet, so a generated project registers none and every
/// native or platform rule shows `MissingNativeScreen`. Native code added to an ejected project
/// registers its screens here before the scene connects.
@MainActor
enum FarmNativeScreens {
    static var registry: [String: FarmNativeScreen] = [:]

    static func make(rule: RouteConfig.Rule, url: URL) -> UIViewController {
        let module = rule.module ?? (url.path.isEmpty ? "/" : url.path)
        if let screen = registry[module] { return screen.makeViewController(url: url) }
        return MissingNativeScreen(screen: rule.screen, module: module, url: url)
    }
}

/// What a native or platform rule shows while no screen is registered for its module.
@MainActor
final class MissingNativeScreen: UIViewController {
    private let screen: String
    private let module: String

    init(screen: String, module: String, url: URL) {
        self.screen = screen
        self.module = module
        super.init(nibName: nil, bundle: nil)
        Navigator.log.warning("\(screen, privacy: .public) screen \"\(module, privacy: .public)\" for \(url.path, privacy: .public) is not in this build")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("MissingNativeScreen is created in code")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.background
        let label = UILabel()
        label.text = screen == "platform"
            ? "The platform screen \(module) is not in this build. Farm does not build page.swift screens yet."
            : "The native screen \(module) is not in this build. Farm does not build page.native.tsx screens yet."
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = Theme.text
        label.font = .preferredFont(forTextStyle: .body)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            label.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
        ])
    }
}
