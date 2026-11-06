import Foundation

/// farm-routes.json, written by farm dev|build --mobile from the app's routes and `mobile`.
struct RouteConfig {
    struct Tab {
        let path: String
        let title: String
        let icon: String
    }

    struct Rule {
        let route: String?
        let pattern: NSRegularExpression
        let presentation: String
        let tab: Int?
        /// `"web"`, `"native"` (React Native, `page.native.tsx`), `"platform"` (`page.swift`), or
        /// `"server"` (drawn from the page the server renders, `FarmServerScreen`).
        let screen: String
        /// The screen's module id, derived from the route, such as `app/notes/[id]`.
        let module: String?

        /// Shown as a native view instead of a WebView, on any rule, including tab roots.
        var isNative: Bool { screen != RouteConfig.web }

        func matches(_ path: String) -> Bool {
            pattern.firstMatch(in: path, range: NSRange(path.startIndex..., in: path)) != nil
        }
    }

    enum LoadError: Error {
        case missing
        case invalid(String)
    }

    static let web = "web"
    private static let screens: Set<String> = [web, "native", "platform", "server"]

    /// The mobile client entry the page shells were rendered with, and each route's shell file.
    struct Shells {
        let client: String
        let routes: [String: String]
    }

    let server: URL
    let tabs: [Tab]
    let rules: [Rule]
    /// Page shells, only in farm build --mobile with mobile.shells.
    let shells: Shells?

    /// scheme://host[:port], the only origin the bridge and link interception trust.
    let origin: String

    init(server: URL, tabs: [Tab], rules: [Rule], shells: Shells? = nil) {
        self.server = server
        self.tabs = tabs
        self.rules = rules
        self.shells = shells
        origin = RouteConfig.origin(of: server) ?? ""
    }

    func url(_ path: String) -> URL {
        guard var components = URLComponents(url: server, resolvingAgainstBaseURL: false) else {
            return server
        }
        components.path = path
        components.query = nil
        components.fragment = nil
        return components.url ?? server
    }

    func isAppURL(_ url: URL) -> Bool {
        !origin.isEmpty && RouteConfig.origin(of: url) == origin
    }

    /// The first rule whose pattern matches the decoded path, or a push.
    func match(_ url: URL) -> Rule {
        let path = url.path.isEmpty ? "/" : url.path
        return rules.first { $0.matches(path) } ?? RouteConfig.fallback
    }

    /// A push of a web screen: unmatched paths, and a server screen that falls back.
    static let fallback = Rule(
        route: nil,
        pattern: NSRegularExpression.farmMatchAll,
        presentation: "push",
        tab: nil,
        screen: web,
        module: nil
    )

    /// The module id farm-routes.json derives for a route: `app` for `/`, else `app<route>`.
    static func moduleOf(_ route: String?) -> String? {
        route.map { $0 == "/" ? "app" : "app\($0)" }
    }

    static func origin(of url: URL) -> String? {
        guard let scheme = url.scheme, let host = url.host, !host.isEmpty else { return nil }
        return origin(scheme: scheme, host: host, port: url.port ?? 0)
    }

    /// Lowercased, without the scheme's default port, as `location.origin` and `WKSecurityOrigin`
    /// spell it (port 0 is the default port).
    static func origin(scheme: String, host: String, port: Int) -> String {
        let scheme = scheme.lowercased()
        let host = host.lowercased()
        let shownHost = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        let defaultPort = (scheme == "http" && port == 80) || (scheme == "https" && port == 443)
        return port == 0 || defaultPort ? "\(scheme)://\(shownHost)" : "\(scheme)://\(shownHost):\(port)"
    }

    private static func rule(_ json: [String: Any]) throws -> Rule {
        guard let source = json["pattern"] as? String, let presentation = json["presentation"] as? String else {
            throw LoadError.invalid("a rule has no pattern or presentation")
        }
        let route = (json["route"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        // A screen tier this shell does not know is a web screen; the page always renders.
        let screen = (json["screen"] as? String).flatMap { screens.contains($0) ? $0 : nil } ?? web
        let module = (json["module"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? moduleOf(route)
        return Rule(
            route: route,
            pattern: try NSRegularExpression(pattern: source),
            presentation: presentation,
            tab: (json["tab"] as? NSNumber)?.intValue,
            screen: screen,
            module: screen == web ? nil : module
        )
    }

    static func load(bundle: Bundle = .main, serverOverride: String?) throws -> RouteConfig {
        guard let file = bundle.url(forResource: "farm-routes", withExtension: "json") else {
            throw LoadError.missing
        }
        let data = try Data(contentsOf: file)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let serverString = serverOverride ?? (json["server"] as? String),
              let server = URL(string: serverString)
        else {
            throw LoadError.invalid("farm-routes.json has no server")
        }
        let tabs = (json["tabs"] as? [[String: Any]] ?? []).map { tab in
            Tab(
                path: tab["path"] as? String ?? "/",
                title: tab["title"] as? String ?? "",
                icon: tab["icon"] as? String ?? ""
            )
        }
        let rules = try (json["rules"] as? [[String: Any]] ?? []).map(rule)
        var shells: Shells?
        if let entry = json["shells"] as? [String: Any], let client = entry["client"] as? String,
           !client.isEmpty, let routes = entry["routes"] as? [String: String] {
            shells = Shells(client: client, routes: routes)
        }
        return RouteConfig(server: server, tabs: tabs, rules: rules, shells: shells)
    }
}

extension NSRegularExpression {
    /// Every same-origin path; a literal pattern that always compiles.
    static let farmMatchAll = try! NSRegularExpression(pattern: "^/")
}
