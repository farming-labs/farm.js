import UIKit
import os

/// A native screen for a rule whose `screen` is `"native"` (`page.native.tsx`) or `"platform"`
/// (`page.swift`). The navigator shows its view controller instead of a WebView.
@MainActor
protocol FarmNativeScreen {
    func makeViewController(url: URL) -> UIViewController
}

/// What a native screen may ask of the navigator, the same calls as Android's `FarmNativeHost`.
/// Called on the main thread.
@MainActor
protocol FarmNativeHost: AnyObject {
    /// Navigate by URL, as a link in a web page would.
    func visit(_ url: URL, replace: Bool)
    /// Replace this screen with the route's web screen (its web twin), after a failure.
    func fallback(_ reason: String)
    func setTitle(_ title: String)
    /// The screen showed its first content.
    func rendered()
}

/// A native screen's content and how to release it when the screen goes.
@MainActor
final class FarmNativeContent {
    let viewController: UIViewController
    let close: () -> Void

    init(_ viewController: UIViewController, close: @escaping () -> Void = {}) {
        self.viewController = viewController
        self.close = close
    }
}

/// The engine for `"native"` screens, such as React Native. There is one per app, made by
/// `createFarmNativeEngine` (NativeEngine.swift); an app without native screens has none.
@MainActor
protocol FarmNativeEngine: AnyObject {
    /// Start ahead of the first native screen. Called after the first screen shows content.
    func warm()
    /// The screen for `rule`, or nil when it cannot show; the navigator then shows the web twin.
    func open(host: FarmNativeHost, rule: RouteConfig.Rule, url: URL) -> FarmNativeContent?
}

/// Native screens by module id, such as `app/notes/[id]`. `"native"` rules render through
/// `engine`; native code added to an ejected project registers its own screens in `registry`
/// before the scene connects, and those win. Rules nothing can show get `MissingNativeScreen`.
@MainActor
enum FarmNativeScreens {
    static var registry: [String: FarmNativeScreen] = [:]
    static var engine: FarmNativeEngine?

    /// Nil when the engine cannot show the screen: show the route as a web screen instead.
    static func make(rule: RouteConfig.Rule, url: URL, host: FarmNativeHost) -> FarmNativeContent? {
        let module = rule.module ?? (url.path.isEmpty ? "/" : url.path)
        if let screen = registry[module] { return FarmNativeContent(screen.makeViewController(url: url)) }
        if rule.screen == "native", let engine { return engine.open(host: host, rule: rule, url: url) }
        return FarmNativeContent(MissingNativeScreen(screen: rule.screen, module: module, url: url))
    }
}

/// What a native or platform rule shows while no screen is registered for its module.
@MainActor
final class MissingNativeScreen: UIViewController {
    private let message: String

    init(screen: String, module: String, url: URL) {
        message = screen == "platform"
            ? "The platform screen \(module) is not in this build. Farm does not build page.swift screens yet."
            : "The native screen \(module) is not in this build."
        super.init(nibName: nil, bundle: nil)
        Navigator.log.warning("\(screen, privacy: .public) screen \"\(module, privacy: .public)\" for \(url.path, privacy: .public) is not in this build")
    }

    /// A native-only route whose screen failed: it has no web twin to fall back to.
    init(failed module: String, reason: String) {
        message = "\(module) could not open: \(reason)"
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("MissingNativeScreen is created in code")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.background
        let label = UILabel()
        label.text = message
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
