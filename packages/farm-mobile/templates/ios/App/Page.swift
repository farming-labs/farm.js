import UIKit
import WebKit
import os

/// Events a WebView page reports to its current owner (a screen or the pool).
@MainActor
protocol PageHost: AnyObject {
    func page(_ page: Page, visit url: URL, replace: Bool)
    func page(_ page: Page, rendered token: Int, title: String, pageMs: Double)
    func page(_ page: Page, renderError token: Int, url: String)
    func pageRouterReady(_ page: Page, title: String)
    func page(_ page: Page, title: String)
    func pageCommitted(_ page: Page)
    func page(_ page: Page, failed error: Error)
    /// The web content process died; the page reloads itself next.
    func pageTerminated(_ page: Page)
}

extension PageHost {
    func page(_ page: Page, rendered token: Int, title: String, pageMs: Double) {}
    func page(_ page: Page, renderError token: Int, url: String) {}
    func pageRouterReady(_ page: Page, title: String) {}
    func page(_ page: Page, title: String) {}
    func pageCommitted(_ page: Page) {}
    func page(_ page: Page, failed error: Error) {}
    func pageTerminated(_ page: Page) {}
}

/// A WKWebView plus its bridge. Moves from the pool into a screen without reloading.
@MainActor
final class Page: NSObject, BridgeListener, WKNavigationDelegate, WKUIDelegate {
    private static let log = Logger(subsystem: "dev.farmjs.mobile.shell", category: "FarmShell")

    let webView: WKWebView
    let bridge: FarmBridge
    weak var host: PageHost?

    /// True once the Farm client router is installed, so render() can navigate in place.
    private(set) var routerReady = false

    /// Set while a native-initiated render is in flight; its document fallback is allowed.
    var renderToken = 0
    private var nextToken = 0
    private(set) var loadStartedAt: CFTimeInterval = 0

    /// True from a load the shell started until it finishes, so its redirects go through.
    private var shellLoad = false
    private(set) var lastURL: URL?
    private let config: RouteConfig
    private let openExternal: (URL) -> Void
    private var titleObservation: NSKeyValueObservation?

    init(
        config: RouteConfig,
        plugins: [String: FarmPlugin],
        script: String,
        openExternal: @escaping (URL) -> Void
    ) {
        self.config = config
        self.openExternal = openExternal
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        bridge = FarmBridge(webView: webView, config: config, plugins: plugins, script: script)
        super.init()
        bridge.listener = self
        webView.isOpaque = false
        webView.backgroundColor = Theme.background
        webView.scrollView.backgroundColor = Theme.background
        // Native bars take the safe area; the screen lays the WebView out inside it.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        #if DEBUG
        // Safari's Web Inspector, for debug builds only.
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        webView.navigationDelegate = self
        webView.uiDelegate = self
        titleObservation = webView.observe(\.title, options: [.new]) { [weak self] webView, _ in
            MainActor.assumeIsolated {
                guard let self, let title = webView.title, !title.isEmpty else { return }
                self.host?.page(self, title: title)
            }
        }
    }

    /// Read by the server: documents for a shell load the mobile client, whose router hands
    /// navigations to the native navigator.
    static let shellHeader = "X-Farm-Shell"

    /// A document load the shell starts, with the shell header.
    func load(_ url: URL) {
        loadStartedAt = CACurrentMediaTime()
        lastURL = url
        shellLoad = true
        var request = URLRequest(url: url)
        request.setValue("ios", forHTTPHeaderField: Page.shellHeader)
        webView.load(request)
    }

    /// Render `url` with the running Farm router. Returns the token echoed by `rendered`.
    @discardableResult
    func render(_ url: URL) -> Int {
        nextToken += 1
        renderToken = nextToken
        bridge.render(url, token: nextToken)
        return nextToken
    }

    func destroy() {
        host = nil
        titleObservation?.invalidate()
        titleObservation = nil
        bridge.detach()
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.removeFromSuperview()
    }

    // MARK: BridgeListener

    func bridge(_ bridge: FarmBridge, visit url: URL, replace: Bool) {
        host?.page(self, visit: url, replace: replace)
    }

    func bridge(_ bridge: FarmBridge, rendered token: Int, title: String, pageMs: Double) {
        if token == renderToken { renderToken = 0 }
        // A sign-in or sign-out that navigated in place changed the WebView's cookies.
        MobileSession.shared?.sync()
        host?.page(self, rendered: token, title: title, pageMs: pageMs)
    }

    func bridge(_ bridge: FarmBridge, renderError token: Int, url: String, message: String) {
        host?.page(self, renderError: token, url: url)
        // The in-place render failed; load the document instead.
        if token == renderToken {
            renderToken = 0
            if let target = URL(string: url), config.isAppURL(target) {
                load(target)
            } else if let lastURL {
                load(lastURL)
            }
        }
    }

    func bridgeRouterReady(_ bridge: FarmBridge, title: String) {
        routerReady = true
        host?.pageRouterReady(self, title: title)
    }

    func bridge(_ bridge: FarmBridge, title: String) {
        host?.page(self, title: title)
    }

    // MARK: WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        let decision = policy(for: navigationAction)
        // WebKit drops a URLRequest's own headers on redirects, and loads the page started
        // (a router fallback, a reload) never had it. Load those again from the shell, so every
        // app document carries the header and keeps the mobile client.
        if decision == .allow, let url = navigationAction.request.url, needsShellHeader(navigationAction, url) {
            decisionHandler(.cancel)
            load(url)
            return
        }
        decisionHandler(decision)
    }

    private func needsShellHeader(_ action: WKNavigationAction, _ url: URL) -> Bool {
        // Back and forward keep their history entries, whatever they load.
        guard config.isAppURL(url), action.targetFrame?.isMainFrame == true,
              action.navigationType != .backForward,
              (action.request.httpMethod ?? "GET").uppercased() == "GET",
              action.request.value(forHTTPHeaderField: Page.shellHeader) == nil
        else { return false }
        // A same-document fragment link never reaches the server.
        if url.fragment != nil, let current = webView.url, current.path == url.path,
           current.query == url.query {
            return false
        }
        return true
    }

    private func policy(for action: WKNavigationAction) -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        // Iframes load what the page asks for; only main-frame navigations are screens.
        if let frame = action.targetFrame, !frame.isMainFrame { return .allow }
        let scheme = url.scheme?.lowercased()
        if scheme != "http" && scheme != "https" {
            openExternal(url)
            return .cancel
        }
        // target=_blank and window.open: a visit, never a second WebView.
        if action.targetFrame == nil {
            host?.page(self, visit: url, replace: false)
            return .cancel
        }
        // Form posts, reloads and back/forward stay in this page.
        if let method = action.request.httpMethod, method.uppercased() != "GET" { return .allow }
        switch action.navigationType {
        case .reload, .backForward, .formResubmitted:
            return .allow
        default:
            break
        }
        // A load the shell started, and the redirects it follows.
        if shellLoad && action.navigationType == .other { return .allow }
        // A render the navigator asked for fell back to a document load: let it through.
        if renderToken != 0 && config.isAppURL(url) { return .allow }
        // Reloads of the current document (dev HMR does location.href = location.href) and
        // same-document fragment links.
        if let current = webView.url, config.isAppURL(url), current.path == url.path,
           current.query == url.query {
            return .allow
        }
        // Plain <a href> taps, location assignments, links to other origins.
        guard let host else { return .allow }
        host.page(self, visit: url, replace: false)
        return .cancel
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        routerReady = false
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        host?.pageCommitted(self)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        shellLoad = false
        if let url = webView.url, config.isAppURL(url) { MobileSession.shared?.sync() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        failed(error)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        failed(error)
    }

    private func failed(_ error: Error) {
        shellLoad = false
        let nsError = error as NSError
        // A navigation this page cancelled (a visit, a newer load) is not a failure.
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return }
        Page.log.error("load failed: \(error.localizedDescription, privacy: .public)")
        host?.page(self, failed: error)
    }

    /// The web content process ended (memory pressure, a crash). Reload this page instead of
    /// leaving a blank screen.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Page.log.warning("web content process ended; reloading \(webView.url?.absoluteString ?? "", privacy: .public)")
        routerReady = false
        renderToken = 0
        host?.pageTerminated(self)
        if let url = webView.url ?? lastURL { load(url) }
    }

    // MARK: WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { host?.page(self, visit: url, replace: false) }
        return nil
    }
}
