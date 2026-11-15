import Foundation
import os

/// Page shells (mobile.shells, RFC 0004 7.2), bundled by farm build --mobile into farm-shells/ and
/// mapped to routes by farm-routes.json: a route's layouts around its loading file, with no scripts
/// and its stylesheets inlined (`loadHTMLString` has no bundled files to load them from). A web
/// screen that loads a document shows its route's shell first, then loads the document over it.
/// Pushes that render in a warm WebView never need one.
///
/// The shells match the client build they were rendered with. When a document loads another
/// mobile client (a deployment newer or older than the app), the shells stop showing, and that is
/// remembered across launches until a document loads this app's client again.
@MainActor
final class PageShells {
    private static let log = Logger(subsystem: "dev.farmjs.mobile.shell", category: "FarmShell")
    private static let directory = "farm-shells"

    private let client: String
    private let routes: [String: String]
    /// Holds the client these shells were turned off for. A file, since launch arguments can set
    /// user defaults.
    private let mismatchFile: URL?
    private var cache: [String: String] = [:]
    private(set) var enabled: Bool

    private init(client: String, routes: [String: String], mismatchFile: URL?) {
        self.client = client
        self.routes = routes
        self.mismatchFile = mismatchFile
        let mismatched = mismatchFile.flatMap { try? String(contentsOf: $0, encoding: .utf8) }
        enabled = mismatched != client
    }

    /// The build's shells, or nil (farm dev --mobile, or mobile.shells is off).
    static func load(config: RouteConfig) -> PageShells? {
        guard let shells = config.shells else { return nil }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        let loaded = PageShells(
            client: shells.client,
            routes: shells.routes,
            mismatchFile: support?.appendingPathComponent("farm-shells-mismatched-client")
        )
        log.info("shells: \(shells.routes.count) routes, client \(shells.client, privacy: .public), enabled=\(loaded.enabled)")
        return loaded
    }

    /// The shell for `rule`'s route, or nil when it has none or shells are off.
    func html(for rule: RouteConfig.Rule) -> String? {
        guard enabled, let route = rule.route, let file = routes[route] else { return nil }
        if let cached = cache[file] { return cached }
        guard let url = Bundle.main.url(forResource: file, withExtension: nil, subdirectory: PageShells.directory),
              let html = try? String(contentsOf: url, encoding: .utf8)
        else {
            PageShells.log.warning("shells: \(file, privacy: .public) is listed but missing from the app")
            return nil
        }
        cache[file] = html
        return html
    }

    /// A document loaded the mobile client entry `loaded` (nil when it loaded none).
    func observe(_ loaded: String?) {
        guard let loaded else { return }
        let same = PageShells.fileName(loaded) == PageShells.fileName(client)
        if same == enabled { return }
        enabled = same
        guard let mismatchFile else { return }
        if same {
            try? FileManager.default.removeItem(at: mismatchFile)
            PageShells.log.info("shells: on; the server runs this app's client again")
        } else {
            try? FileManager.default.createDirectory(
                at: mismatchFile.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try? client.write(to: mismatchFile, atomically: true, encoding: .utf8)
            PageShells.log.info("shells: off; the server runs another client build (\(loaded, privacy: .public))")
        }
    }

    private static func fileName(_ path: String) -> Substring {
        path.split(separator: "/").last ?? Substring(path)
    }
}
