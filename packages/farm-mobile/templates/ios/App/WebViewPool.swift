import UIKit
import os

/// Pre-warmed WebViews. Each one loads `warmPath` and is handed out only after the Farm client
/// router is installed, so a push renders with an in-page navigation instead of WebView startup
/// plus a document load.
///
/// Warm pages sit in `holder`, behind the opaque navigator, so WebKit lays them out at screen size
/// and keeps running their frames. A page taken from the pool stays there while it renders the
/// target, and moves into its screen when the screen appears.
@MainActor
final class WebViewPool: PageHost {
    private static let log = Logger(subsystem: "dev.farmjs.mobile.shell", category: "FarmShell")

    private let config: RouteConfig
    private let holder: UIView
    private let size: Int
    private let warmPath: String
    private let factory: () -> Page
    private var warming: [Page] = []
    private var ready: [Page] = []
    private var started = false

    init(config: RouteConfig, holder: UIView, size: Int, warmPath: String, factory: @escaping () -> Page) {
        self.config = config
        self.holder = holder
        self.size = size
        self.warmPath = warmPath
        self.factory = factory
    }

    var readyCount: Int { ready.count }

    func start() {
        started = true
        fill()
    }

    private func fill() {
        guard started else { return }
        while warming.count + ready.count < size {
            let page = factory()
            page.host = self
            page.webView.frame = holder.bounds
            page.webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            holder.addSubview(page.webView)
            warming.append(page)
            page.load(config.url(warmPath))
        }
    }

    /// A warm page, or nil when none is ready (the caller loads a cold one).
    func take() -> Page? {
        // Refill after the transition, so warming does not compete with it.
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(500)) { [weak self] in
            self?.fill()
        }
        guard !ready.isEmpty else { return nil }
        let page = ready.removeFirst()
        page.host = nil
        return page
    }

    func pageRouterReady(_ page: Page, title: String) {
        guard let index = warming.firstIndex(where: { $0 === page }) else { return }
        warming.remove(at: index)
        ready.append(page)
        let ms = Int((CACurrentMediaTime() - page.loadStartedAt) * 1000)
        WebViewPool.log.info("pool: warmed in \(ms) ms (ready=\(self.ready.count))")
    }

    /// A warm page whose process ended reloads; it is not ready until its router is back.
    func pageTerminated(_ page: Page) {
        guard let index = ready.firstIndex(where: { $0 === page }) else { return }
        ready.remove(at: index)
        warming.append(page)
    }

    /// A warm page that could not load is dropped; the next take() refills the pool.
    func page(_ page: Page, failed error: Error) {
        warming.removeAll { $0 === page }
        ready.removeAll { $0 === page }
        page.destroy()
    }

    // A warm page never navigates on its own; ignore anything it tries.
    func page(_ page: Page, visit url: URL, replace: Bool) {}
}
