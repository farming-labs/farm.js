import SafariServices
import UIKit
import os

/// The native navigator (RFC 0004, section 7.4). Every tab owns a UINavigationController stack,
/// every screen shows one WebView (or a native view for a `"native"` or `"platform"` rule), and
/// farm-routes.json decides how a visit is presented: switch tab, push, present as a sheet, or
/// replace in place. Without tabs the app is one stack starting at `startPath`.
@MainActor
final class Navigator: NSObject, UITabBarControllerDelegate, UIAdaptivePresentationControllerDelegate {
    static let log = Logger(subsystem: "dev.farmjs.mobile.shell", category: "FarmShell")
    private static let warmWait: DispatchTimeInterval = .milliseconds(250)
    /// The longest a transition blocks visits, if UIKit never reports its end.
    private static let transitionCap: DispatchTimeInterval = .seconds(1)

    /// The tab bar controller, or the single stack when there are no tabs.
    let rootViewController: UIViewController
    private let config: RouteConfig
    private let startPath: String
    private let pool: WebViewPool?
    private let newPage: () -> Page
    /// Page shells for cold document loads; nil without mobile.shells.
    private let shells: PageShells?
    private let tabs: UITabBarController?
    private let stacks: [UINavigationController]
    private var modal: UINavigationController?
    private var transitioning = false
    private var transition = 0

    /// Runs once, when the first tab's page is interactive (used to start warming the pool).
    var onFirstReady: (() -> Void)?

    init(
        config: RouteConfig,
        startPath: String,
        tabIcons: [String],
        pool: WebViewPool?,
        shells: PageShells? = nil,
        newPage: @escaping () -> Page
    ) {
        self.config = config
        self.startPath = startPath
        self.pool = pool
        self.shells = shells
        self.newPage = newPage
        let count = max(config.tabs.count, 1)
        stacks = (0..<count).map { index in
            let stack = UINavigationController()
            stack.navigationBar.prefersLargeTitles = false
            stack.interactivePopGestureRecognizer?.isEnabled = true
            if index < config.tabs.count {
                let tab = config.tabs[index]
                let symbol = index < tabIcons.count ? tabIcons[index] : tab.icon
                let image = UIImage(systemName: symbol) ?? UIImage(systemName: "square.grid.2x2")
                stack.tabBarItem = UITabBarItem(title: tab.title, image: image, tag: index)
            }
            return stack
        }
        if config.tabs.isEmpty {
            tabs = nil
            rootViewController = stacks[0]
        } else {
            let controller = UITabBarController()
            controller.setViewControllers(stacks, animated: false)
            tabs = controller
            rootViewController = controller
        }
        super.init()
        tabs?.delegate = self
    }

    func start() {
        selectTab(0)
    }

    private var current: Int { tabs?.selectedIndex ?? 0 }

    private func rootPath(_ index: Int) -> String {
        index < config.tabs.count ? config.tabs[index].path : startPath
    }

    // MARK: Visits

    func visit(from: ScreenViewController, url: URL, replace: Bool) {
        if transitioning { return }
        guard config.isAppURL(url) else {
            openExternal(url)
            return
        }
        let rule = config.match(url)
        let shown = rule.isNative ? "\(rule.screen) \(rule.module ?? "")" : rule.presentation
        Navigator.log.info("visit \(url.path, privacy: .public) -> \(shown, privacy: .public) (rule \(rule.route ?? "fallback", privacy: .public))")
        if rule.presentation == "tab", let tab = rule.tab, tab < stacks.count {
            if modal != nil { dismissModal(refresh: false) }
            selectTab(tab)
            stacks[tab].popToRootViewController(animated: false)
        } else if rule.presentation == "modal" {
            presentModal(url, rule: rule)
        } else if (replace || rule.presentation == "replace") && !rule.isNative && from.page != nil {
            from.render(url)
        } else if from.isModal {
            // A push from inside a modal (for example "save, then show the note") closes the
            // modal and pushes on the tab underneath.
            dismissModal(refresh: true)
            push(url, rule: rule)
        } else {
            push(url, rule: rule)
        }
    }

    /// Links to other origins open in SFSafariViewController; other schemes go to the app that
    /// handles them.
    func openExternal(_ url: URL) {
        Navigator.log.info("external \(url.absoluteString, privacy: .public)")
        switch url.scheme?.lowercased() {
        case "http", "https":
            let safari = SFSafariViewController(url: url)
            safari.preferredControlTintColor = Theme.accent
            topPresenter.present(safari, animated: true)
        case nil, "file", "javascript", "data", "blob", "about", "content", "intent":
            // Never hand local or script URLs to another app.
            return
        default:
            UIApplication.shared.open(url)
        }
    }

    private var topPresenter: UIViewController {
        var top = rootViewController
        while let presented = top.presentedViewController { top = presented }
        return top
    }

    // MARK: Tabs

    func selectTab(_ index: Int) {
        ensureRoot(index)
        if let tabs, tabs.selectedIndex != index { tabs.selectedIndex = index }
    }

    /// A tab's root screen is created the first time the tab is shown. It is a screen like any
    /// other: its rule may be native or platform.
    private func ensureRoot(_ index: Int) {
        let stack = stacks[index]
        guard stack.viewControllers.isEmpty else { return }
        let path = rootPath(index)
        let url = config.url(path)
        let screen = makeScreen(isModal: false, rule: config.match(url), url: url)
        stack.setViewControllers([screen], animated: false)
        show(screen, url: url, label: "tab \(path)", onContent: { [weak self] in
            guard index == 0, let self, let ready = self.onFirstReady else { return }
            self.onFirstReady = nil
            ready()
        }, ready: {})
    }

    func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        if let index = stacks.firstIndex(where: { $0 === viewController }) { ensureRoot(index) }
        return true
    }

    // MARK: Push

    private func push(_ url: URL, rule: RouteConfig.Rule) {
        let stack = stacks[current]
        let screen = makeScreen(isModal: false, rule: rule, url: url)
        let id = beginTransition()
        show(screen, url: url, label: "push \(url.path)") { [weak self] in
            stack.pushViewController(screen, animated: true)
            guard let coordinator = stack.transitionCoordinator else {
                self?.endTransition(id)
                return
            }
            coordinator.animate(alongsideTransition: nil) { _ in self?.endTransition(id) }
        }
    }

    /// Visits are ignored while a screen animates in. The transition ends when UIKit says so, or
    /// after `transitionCap`, so a completion UIKit never calls cannot stop navigation for good.
    private func beginTransition() -> Int {
        transition += 1
        transitioning = true
        let id = transition
        DispatchQueue.main.asyncAfter(deadline: .now() + Navigator.warmWait + Navigator.transitionCap) {
            [weak self] in self?.endTransition(id)
        }
        return id
    }

    private func endTransition(_ id: Int) {
        if id == transition { transitioning = false }
    }

    // MARK: Modal

    private func presentModal(_ url: URL, rule: RouteConfig.Rule) {
        guard modal == nil else { return }
        let screen = makeScreen(isModal: true, rule: rule, url: url)
        screen.navigationItem.leftBarButtonItem = UIBarButtonItem(
            systemItem: .close,
            primaryAction: UIAction { [weak self] _ in self?.dismissModal(refresh: false) }
        )
        let sheet = UINavigationController(rootViewController: screen)
        sheet.modalPresentationStyle = .pageSheet
        sheet.presentationController?.delegate = self
        modal = sheet
        let id = beginTransition()
        show(screen, url: url, label: "modal \(url.path)") { [weak self] in
            guard let self else { return }
            self.topPresenter.present(sheet, animated: true) { [weak self] in self?.endTransition(id) }
        }
    }

    private func dismissModal(refresh: Bool) {
        guard let sheet = modal else { return }
        modal = nil
        sheet.dismiss(animated: true)
        // The screen under the modal may show data the modal changed.
        if refresh, let top = stacks[current].topViewController as? ScreenViewController {
            top.page?.bridge.refresh()
        }
    }

    /// The sheet was swiped down.
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        if presentationController.presentedViewController === modal { modal = nil }
    }

    // MARK: Screens

    private func makeScreen(isModal: Bool, rule: RouteConfig.Rule, url: URL) -> ScreenViewController {
        if rule.screen == "server" {
            let holder = ScreenHolder()
            let content = FarmServerScreen(
                url: url,
                visit: { [weak self] target in
                    guard let self, let screen = holder.screen else { return }
                    self.visit(from: screen, url: target, replace: false)
                },
                fallback: { [weak self] reason in
                    guard let self, let screen = holder.screen else { return }
                    self.showWeb(replacing: screen, url: url, reason: reason)
                }
            )
            let screen = ScreenViewController(
                page: nil,
                nativeContent: content,
                nativeModule: rule.module ?? url.path,
                isModal: isModal,
                isWarm: false,
                navigator: self
            )
            // The tree's title replaces it once loaded; never show the module id.
            screen.navigationItem.title = ""
            holder.screen = screen
            return screen
        }
        if rule.isNative {
            return ScreenViewController(
                page: nil,
                nativeContent: FarmNativeScreens.make(rule: rule, url: url),
                nativeModule: rule.module ?? url.path,
                isModal: isModal,
                isWarm: false,
                navigator: self
            )
        }
        let warm = pool?.take()
        return ScreenViewController(
            page: warm ?? newPage(),
            nativeContent: nil,
            nativeModule: nil,
            isModal: isModal,
            isWarm: warm != nil,
            navigator: self
        )
    }

    /// A server screen that cannot draw its page shows the web screen in its place.
    private func showWeb(replacing screen: ScreenViewController, url: URL, reason: String) {
        Navigator.log.warning("server screen \(screen.nativeModule ?? "", privacy: .public) failed, showing the web screen for \(url.path, privacy: .public): \(reason, privacy: .public)")
        guard let stack = screen.navigationController else { return }
        let web = makeScreen(isModal: screen.isModal, rule: RouteConfig.fallback, url: url)
        web.navigationItem.leftBarButtonItem = screen.navigationItem.leftBarButtonItem
        show(web, url: url, label: "fallback \(url.path)") {
            var controllers = stack.viewControllers
            guard let index = controllers.firstIndex(of: screen) else { return }
            controllers[index] = web
            stack.setViewControllers(controllers, animated: false)
        }
    }

    /// Fill `screen` with `url` and call `ready` when it should animate in: a warm page waits for
    /// its in-place render (capped), a cold page animates right away and shows a spinner while the
    /// document loads, a native screen is ready at once.
    private func show(
        _ screen: ScreenViewController,
        url: URL,
        label: String,
        onContent: @escaping () -> Void = {},
        ready: @escaping () -> Void
    ) {
        guard let page = screen.page else {
            Navigator.log.info("\(label, privacy: .public) native=\(screen.nativeModule ?? "", privacy: .public)")
            ready()
            onContent()
            return
        }
        let started = CACurrentMediaTime()
        let warm = screen.isWarm && page.routerReady
        var fired = false
        let fire = {
            if !fired {
                fired = true
                ready()
            }
        }
        screen.onShown = { [weak self] _ in
            let ms = Int((CACurrentMediaTime() - started) * 1000)
            Navigator.log.info("\(label, privacy: .public) warm=\(warm) visit->content=\(ms)ms (pool ready=\(self?.pool?.readyCount ?? 0))")
            fire()
            onContent()
        }
        if warm {
            screen.render(url)
            DispatchQueue.main.asyncAfter(deadline: .now() + Navigator.warmWait) { fire() }
        } else {
            // A warm render never shows a shell: the running page is already there.
            let shell = shells?.html(for: config.match(url))
            screen.onPainted = {
                let ms = Int((CACurrentMediaTime() - started) * 1000)
                Navigator.log.info("\(label, privacy: .public) warm=false shell=\(shell != nil) visit->commit=\(ms)ms")
            }
            screen.load(url, shell: shell)
            fire()
        }
    }
}

/// The screen a server screen's callbacks act on, set once it exists.
@MainActor
private final class ScreenHolder {
    weak var screen: ScreenViewController?
}
