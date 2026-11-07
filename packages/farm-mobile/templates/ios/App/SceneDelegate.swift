import UIKit
import os

/// Launch options for `farm dev --mobile --os ios` builds only:
///   xcrun simctl launch booted <id> -FarmServer http://localhost:3001   load a different Farm server
///   xcrun simctl launch booted <id> -FarmPool 0                          disable the warm pool
/// Every other build ignores them, so nothing can point a `farm build --mobile` app, and the
/// origin its bridge trusts, at another server. Every build reads `LaunchOpen` instead.
struct LaunchOptions {
    static let poolSize = 2

    let server: String?
    let pool: Int

    static func read(arguments: [String], dev: Bool) -> LaunchOptions {
        guard dev else { return LaunchOptions(server: nil, pool: poolSize) }
        func value(_ name: String) -> String? {
            guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
            return arguments[index + 1]
        }
        let server = value("-FarmServer").flatMap { value -> String? in
            guard let url = URL(string: value), let scheme = url.scheme?.lowercased(),
                  scheme == "http" || scheme == "https", url.host != nil
            else { return nil }
            return value
        }
        let pool = value("-FarmPool").flatMap { Int($0) }.map { max(0, min($0, 4)) } ?? poolSize
        return LaunchOptions(server: server, pool: pool)
    }
}

/// A launch option every build reads, because it only does what a tapped link to the app's own
/// server does:
///   xcrun simctl launch booted <id> -FarmOpen /kit [-FarmOpenAfter 3000]
/// visits that path once the first screen shows content (when the native engine starts warming),
/// or that many milliseconds later. CI opens a native screen cold and warm with it.
struct LaunchOpen {
    let path: String
    let afterMs: Int

    static func read(arguments: [String]) -> LaunchOpen? {
        func value(_ name: String) -> String? {
            guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
            return arguments[index + 1]
        }
        // A path on the app's server, never another origin.
        guard let path = value("-FarmOpen"), path.hasPrefix("/"), !path.hasPrefix("//"),
              !path.contains("\\")
        else { return nil }
        let after = value("-FarmOpenAfter").flatMap { Int($0) }.map { max(0, min($0, 60_000)) } ?? 0
        return LaunchOpen(path: path, afterMs: after)
    }
}

/// The window's root: the warm pool's holder at the back, the navigator on top of it.
final class ShellViewController: UIViewController {
    let poolHolder = UIView()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.background
        poolHolder.frame = view.bounds
        poolHolder.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        poolHolder.isUserInteractionEnabled = false
        poolHolder.accessibilityElementsHidden = true
        view.addSubview(poolHolder)
    }

    func show(_ child: UIViewController) {
        addChild(child)
        child.view.frame = view.bounds
        child.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(child.view)
        child.didMove(toParent: self)
        setNeedsStatusBarAppearanceUpdate()
    }

    override var childForStatusBarStyle: UIViewController? { children.last }
    override var childForHomeIndicatorAutoHidden: UIViewController? { children.last }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var navigator: Navigator?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        // Launch overrides only under farm dev --mobile, never in a farm build --mobile app.
        let arguments = ProcessInfo.processInfo.arguments
        let launch = LaunchOptions.read(arguments: arguments, dev: FarmBuild.dev)
        let open = LaunchOpen.read(arguments: arguments)
        let config: RouteConfig
        do {
            config = try RouteConfig.load(serverOverride: launch.server)
        } catch {
            fatalError("farm-routes.json could not be read: \(error)")
        }
        guard let scriptURL = Bundle.main.url(forResource: "farm-bridge", withExtension: "js"),
              let script = try? String(contentsOf: scriptURL, encoding: .utf8)
        else {
            fatalError("farm-bridge.js is missing from the app bundle")
        }
        Navigator.log.info("server=\(config.server.absoluteString, privacy: .public) pool=\(launch.pool) rules=\(config.rules.count)")
        // The device token native screens call the server with; issued after a web sign-in.
        _ = MobileSession.start(config: config)

        // Device plugins reachable as native.<name>; none ship yet, so calls reject as unavailable.
        let plugins: [String: FarmPlugin] = [:]

        let shell = ShellViewController()
        let window = UIWindow(windowScene: windowScene)
        window.tintColor = Theme.accent
        window.rootViewController = shell
        self.window = window
        (UIApplication.shared.delegate as? AppDelegate)?.window = window
        window.makeKeyAndVisible()

        // Page shells, bundled by farm build --mobile with mobile.shells.
        let shells = PageShells.load(config: config)
        let newPage: () -> Page = { [weak self] in
            Page(config: config, plugins: plugins, script: script, shells: shells) { url in
                self?.navigator?.openExternal(url)
            }
        }
        let warmPath = config.tabs.first?.path ?? FarmBuild.startPath
        let pool = launch.pool > 0
            ? WebViewPool(config: config, holder: shell.poolHolder, size: launch.pool, warmPath: warmPath, factory: newPage)
            : nil
        let navigator = Navigator(
            config: config,
            startPath: FarmBuild.startPath,
            tabIcons: FarmBuild.tabIcons,
            pool: pool,
            shells: shells,
            newPage: newPage
        )
        // React Native when the app has page.native.tsx screens; warmed after the first screen shows.
        let engine = createFarmNativeEngine(config: config)
        FarmNativeScreens.engine = engine
        navigator.onFirstReady = { [weak navigator] in
            LaunchTiming.logFirstContent()
            pool?.start()
            engine?.warm()
            guard let open else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(open.afterMs)) {
                Navigator.log.notice("launch open \(open.path, privacy: .public) after \(open.afterMs)ms")
                navigator?.visitPath(open.path)
            }
        }
        self.navigator = navigator
        shell.show(navigator.rootViewController)
        navigator.start()
    }
}
