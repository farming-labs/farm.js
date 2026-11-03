import Foundation
import Security
import WebKit
import os

/// The device session native screens call the server with (RFC 0004, 7.14).
///
/// After a web screen signs in, the WebView holds the app's session cookie. This class, in native
/// code only, trades it for a device token: it asks the server for a one-time nonce
/// (`/__farm/mobile/session/challenge`) and exchanges it with the same cookies for an access and a
/// refresh token (`/__farm/mobile/session`). Neither the nonce nor the tokens ever enter a
/// WebView. The tokens live in the Keychain, readable only on this device after first unlock.
///
/// Signing out on a web screen makes the server revoke the device and clear its `farm_mobile`
/// marker cookie; the next sync sees the marker gone and deletes the tokens. A refresh the server
/// refuses deletes them too.
@MainActor
final class MobileSession {
    struct Tokens: Codable, Equatable {
        let access: String
        let refresh: String
    }

    private static let log = Logger(subsystem: "dev.farmjs.mobile.shell", category: "FarmSession")
    private static let marker = "farm_mobile"
    private static let keychainService = "dev.farmjs.mobile.session"
    private static let keychainAccount = "tokens"

    /// One per process; created by the scene delegate.
    private(set) static var shared: MobileSession?

    static func start(config: RouteConfig) -> MobileSession {
        if let shared { return shared }
        let session = MobileSession(config: config)
        shared = session
        return session
    }

    /// The `X-Farm-Mobile` header: `mobile.id`, the bundle id.
    let appId = Bundle.main.bundleIdentifier ?? ""
    private let config: RouteConfig
    private let serverURL: URL
    private var tokens: Tokens?
    private var syncing = false
    /// The WebView cookies the last issue attempt used, so a signed-out WebView asks once.
    private var attempted: String?
    private var refreshing: Task<String?, Never>?
    private let http: URLSession

    private init(config: RouteConfig) {
        self.config = config
        serverURL = config.url(FarmBuild.basePath.isEmpty ? "/" : FarmBuild.basePath)
        let configuration = URLSessionConfiguration.ephemeral
        // Cookies go only where this class puts them: never into a shared jar.
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 10
        http = URLSession(configuration: configuration)
        tokens = Self.readKeychain()
    }

    /// The current access token, or nil while signed out.
    var accessToken: String? { tokens?.access }

    /// After a web screen loads or renders: issue after a sign-in, delete after a web sign-out.
    func sync() {
        guard !syncing else { return }
        syncing = true
        Task {
            defer { syncing = false }
            let cookies = await serverCookies()
            let hasMarker = cookies.contains { $0.name == Self.marker }
            if tokens != nil {
                if !hasMarker {
                    Self.log.info("signed out on the web; deleting the device token")
                    clear()
                }
                return
            }
            let session = cookies.filter { $0.name != Self.marker }
            let header = HTTPCookie.requestHeaderFields(with: cookies)["Cookie"] ?? ""
            guard !session.isEmpty, header != attempted else { return }
            attempted = header
            await issue(cookieHeader: header)
        }
    }

    /// A new access token after `failed` was rejected, or nil when the device is signed out.
    /// Concurrent callers share one refresh, since the server treats a reused refresh token as
    /// stolen.
    func refresh(failed: String) async -> String? {
        if let refreshing { return await refreshing.value }
        guard let current = tokens else { return nil }
        if current.access != failed { return current.access }
        let task = Task<String?, Never> {
            let reply = await post("/__farm/mobile/session/refresh", bearer: current.refresh)
            switch reply.status {
            case 200:
                if let next = Self.tokens(from: reply.body) {
                    save(next)
                    return next.access
                }
                return nil
            case 400, 401:
                clear()
                return nil
            default:
                // Offline or a server error: keep the tokens and let the call fail.
                return nil
            }
        }
        refreshing = task
        defer { refreshing = nil }
        return await task.value
    }

    /// Revoke the device on the server, delete its tokens, and drop the server's WebView cookies.
    func signOut() async {
        let revoked = tokens
        clear()
        if let revoked {
            _ = await post("/__farm/mobile/session/revoke", bearer: revoked.refresh)
        }
        let store = WKWebsiteDataStore.default().httpCookieStore
        for cookie in await serverCookies() {
            await store.deleteCookie(cookie)
        }
    }

    private func issue(cookieHeader: String) async {
        let challenge = await post("/__farm/mobile/session/challenge", cookies: cookieHeader)
        guard challenge.status == 200, let nonce = challenge.body?["nonce"] as? String, !nonce.isEmpty else {
            return
        }
        let issued = await post("/__farm/mobile/session", cookies: cookieHeader, nonce: nonce)
        if issued.status == 200, let next = Self.tokens(from: issued.body) {
            save(next)
            Self.log.info("device session issued")
        }
    }

    private struct Reply {
        let status: Int
        let body: [String: Any]?
    }

    /// A request no WebView can make: native, no Origin, with the app id. Everything travels in
    /// headers; the endpoints read no body.
    private func post(
        _ path: String,
        cookies: String? = nil,
        bearer: String? = nil,
        nonce: String? = nil
    ) async -> Reply {
        var request = URLRequest(url: config.url(FarmBuild.basePath + path))
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue(appId, forHTTPHeaderField: "X-Farm-Mobile")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let cookies { request.setValue(cookies, forHTTPHeaderField: "Cookie") }
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let nonce { request.setValue(nonce, forHTTPHeaderField: "X-Farm-Mobile-Nonce") }
        do {
            let (data, response) = try await http.data(for: request)
            guard let response = response as? HTTPURLResponse else { return Reply(status: 0, body: nil) }
            // The device marker goes into the WebView cookie store, where web sign-out finds it.
            let fields = response.allHeaderFields.reduce(into: [String: String]()) { result, entry in
                if let key = entry.key as? String, let value = entry.value as? String { result[key] = value }
            }
            let store = WKWebsiteDataStore.default().httpCookieStore
            for cookie in HTTPCookie.cookies(withResponseHeaderFields: fields, for: serverURL) {
                await store.setCookie(cookie)
            }
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            return Reply(status: response.statusCode, body: json)
        } catch {
            Self.log.error("session request \(path, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            return Reply(status: 0, body: nil)
        }
    }

    /// The WebView's cookies for the server's host.
    private func serverCookies() async -> [HTTPCookie] {
        guard let host = serverURL.host?.lowercased() else { return [] }
        let all = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        return all.filter { cookie in
            let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return host == domain || host.hasSuffix(".\(domain)")
        }
    }

    private static func tokens(from body: [String: Any]?) -> Tokens? {
        guard let access = body?["accessToken"] as? String, let refresh = body?["refreshToken"] as? String else {
            return nil
        }
        return Tokens(access: access, refresh: refresh)
    }

    private func save(_ next: Tokens) {
        tokens = next
        Self.writeKeychain(next)
    }

    private func clear() {
        tokens = nil
        attempted = nil
        Self.writeKeychain(nil)
    }

    // MARK: Keychain

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
    }

    private static func readKeychain() -> Tokens? {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(search as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(Tokens.self, from: data)
    }

    private static func writeKeychain(_ tokens: Tokens?) {
        SecItemDelete(query as CFDictionary)
        guard let tokens, let data = try? JSONEncoder().encode(tokens) else { return }
        var item = query
        item[kSecValueData as String] = data
        // Never synced to iCloud or restored to another device.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        if status != errSecSuccess {
            log.error("keychain write failed: \(status, privacy: .public)")
        }
    }
}
