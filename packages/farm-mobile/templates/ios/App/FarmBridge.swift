import Foundation
import WebKit
import os

/// A device capability reachable from JS as __farmBridge.call(name, method, args).
@MainActor
protocol FarmPlugin: AnyObject {
    var name: String { get }

    /// Runs on the main thread. Return a JSON value (or nil) to resolve, or throw to reject.
    func call(method: String, args: [String: Any], webView: WKWebView) throws -> Any?
}

/// Messages a page sends to whoever currently owns its WebView.
@MainActor
protocol BridgeListener: AnyObject {
    func bridge(_ bridge: FarmBridge, visit url: URL, replace: Bool)
    func bridge(_ bridge: FarmBridge, rendered token: Int, title: String, pageMs: Double)
    func bridgeRouterReady(_ bridge: FarmBridge, title: String)
    func bridge(_ bridge: FarmBridge, title: String)
    func bridge(_ bridge: FarmBridge, renderError token: Int, url: String, message: String)
}

/// One bridge per WebView. Pooled WebViews keep their bridge when they move into a screen; only
/// `listener` changes.
///
/// The bridge script is a document-start WKUserScript for the main frame, wrapped in an origin
/// check, so pages on other origins never get `__farmBridge` or the message port. Messages in
/// arrive through a WKScriptMessageHandler that drops anything not sent by the main frame of the
/// app's origin; replies go out through evaluateJavaScript, only into a page on that origin.
@MainActor
final class FarmBridge: NSObject, WKScriptMessageHandler {
    static let handlerName = "farmNative"
    private static let log = Logger(subsystem: "dev.farmjs.mobile.shell", category: "FarmBridge")

    weak var listener: BridgeListener?
    private weak var webView: WKWebView?
    private let config: RouteConfig
    private let plugins: [String: FarmPlugin]

    init(webView: WKWebView, config: RouteConfig, plugins: [String: FarmPlugin], script: String) {
        self.webView = webView
        self.config = config
        self.plugins = plugins
        super.init()
        let source = script.replacingOccurrences(
            of: "__FARM_PLUGINS__",
            with: FarmBridge.json(plugins.keys.sorted()) ?? "[]"
        )
        // WKUserScript has no origin rules (Android's document-start script does), so the script
        // checks the origin itself before it touches the page.
        let scoped = "if (location.origin === \(FarmBridge.jsString(config.origin))) {\n\(source)\n}"
        let controller = webView.configuration.userContentController
        controller.addUserScript(
            WKUserScript(source: scoped, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        controller.add(self, contentWorld: .page, name: FarmBridge.handlerName)
    }

    /// Removes the message handler; the WebView is going away.
    func detach() {
        webView?.configuration.userContentController.removeScriptMessageHandler(
            forName: FarmBridge.handlerName,
            contentWorld: .page
        )
        listener = nil
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        // Only the main frame of the app's origin may talk to native: never an iframe, and never a
        // page on another origin the WebView ended up on.
        guard message.frameInfo.isMainFrame,
              FarmBridge.origin(of: message.frameInfo.securityOrigin) == config.origin,
              message.webView === webView,
              let raw = message.body as? String
        else { return }
        handle(raw)
    }

    static func origin(of origin: WKSecurityOrigin) -> String {
        RouteConfig.origin(scheme: origin.protocol, host: origin.host, port: origin.port)
    }

    func render(_ url: URL, token: Int) {
        evaluate("window.__farmBridge && window.__farmBridge.render(\(FarmBridge.jsString(url.absoluteString)), \(token))")
    }

    func refresh() {
        evaluate("window.__farmBridge && window.__farmBridge.refresh()")
    }

    private func evaluate(_ js: String) {
        // Never evaluate into a page that is not the app (an error page, a redirect elsewhere).
        guard let webView, let current = webView.url, config.isAppURL(current) else { return }
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func handle(_ raw: String) {
        // Malformed messages are dropped, never thrown.
        guard let data = raw.data(using: .utf8),
              let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = message["type"] as? String
        else { return }
        let string = { (key: String) in message[key] as? String ?? "" }
        let token = FarmBridge.integer(message["token"]) ?? 0
        switch type {
        case "call":
            call(message)
        case "visit":
            guard let href = message["url"] as? String, !href.isEmpty,
                  let url = URL(string: href, relativeTo: webView?.url)?.absoluteURL
            else { return }
            listener?.bridge(self, visit: url, replace: string("action") == "replace")
        case "rendered":
            let ms = (message["ms"] as? NSNumber)?.doubleValue ?? 0
            listener?.bridge(self, rendered: token, title: string("title"), pageMs: ms)
        case "router-ready":
            listener?.bridgeRouterReady(self, title: string("title"))
        case "title":
            listener?.bridge(self, title: string("title"))
        case "error":
            FarmBridge.log.warning("render error: \(string("message"), privacy: .public)")
            listener?.bridge(self, renderError: token, url: string("url"), message: string("message"))
        default:
            return
        }
    }

    private func call(_ message: [String: Any]) {
        // A call without a numeric id cannot be answered; drop it.
        guard let id = FarmBridge.integer(message["id"]) else { return }
        let pluginName = message["plugin"] as? String ?? ""
        let method = message["method"] as? String ?? ""
        let args = message["args"] as? [String: Any] ?? [:]
        let started = CACurrentMediaTime()
        let ok: Bool
        let value: Any?
        if let plugin = plugins[pluginName], let webView {
            do {
                value = try plugin.call(method: method, args: args, webView: webView)
                ok = true
            } catch {
                value = ["code": "native_error", "message": "\(error)"]
                ok = false
            }
        } else {
            value = ["code": "native_unavailable", "message": "No native plugin \"\(pluginName)\"."]
            ok = false
        }
        let payload = FarmBridge.json(value) ?? "null"
        if FarmBuild.dev {
            let ms = (CACurrentMediaTime() - started) * 1000
            FarmBridge.log.info(
                "call #\(id) \(pluginName, privacy: .public).\(method, privacy: .public) ok=\(ok) -> \(payload, privacy: .public) (\(ms) ms native)"
            )
        }
        evaluate("window.__farmBridge._resolve(\(id), \(ok), \(payload))")
    }

    /// An integral JSON number; booleans and fractions are not ids or tokens.
    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
            return nil
        }
        let double = number.doubleValue
        guard double.isFinite, double == double.rounded(), abs(double) < 9_007_199_254_740_992 else {
            return nil
        }
        return Int(double)
    }

    /// A JSON value as JS source, or nil when it is not JSON (nil itself is `null`).
    static func json(_ value: Any?) -> String? {
        let wrapped: [Any] = [value ?? NSNull()]
        guard JSONSerialization.isValidJSONObject(wrapped),
              let data = try? JSONSerialization.data(withJSONObject: wrapped),
              let array = String(data: data, encoding: .utf8)
        else { return nil }
        // "[<value>]" -> "<value>"
        return String(array.dropFirst().dropLast())
    }

    /// A Swift string as a JS string literal.
    static func jsString(_ value: String) -> String {
        json(value) ?? "\"\""
    }
}
