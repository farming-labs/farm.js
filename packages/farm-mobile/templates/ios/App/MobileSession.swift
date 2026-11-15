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
/// A native screen signs in through `signIn(path:body:)`: native code sends the credentials to the
/// auth route, puts the session cookie it gets into the WebView's cookie store, and issues the
/// device token from it the same way. So a native sign-in signs in every web screen too.
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
        http = URLSession(configuration: configuration, delegate: RefuseRedirects(), delegateQueue: nil)
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

    /// What `signIn(path:body:)` hands back to JS: the auth route's status and body, never its
    /// cookies.
    struct SignInReply {
        let status: Int
        let body: String
    }

    enum SignInError: Error {
        case notAnAuthRoute(String)
        case unreachable(String)
        case notIssued(Int)
    }

    /// Sign in from a native screen (`signIn`/`signUp` from `@farm.js/auth/client`): POST the JSON
    /// `body` to `path`, which must be a route under `auth.basePath`, on `mobile.server` only, with
    /// no cookies and without following redirects. A success's cookies go into the WebView's
    /// cookie store, as a web sign-in's would, and the device token is issued from them with the
    /// same challenge and exchange; any earlier device token is revoked first. A failure keeps no
    /// cookie and issues nothing. Returns once the token is stored.
    func signIn(path: String, body: String) async throws -> SignInReply {
        guard Self.isAuthRoute(path, authBasePath: FarmBuild.authBasePath) else {
            throw SignInError.notAnAuthRoute(path)
        }
        var request = URLRequest(url: config.url(FarmBuild.basePath + path))
        request.httpMethod = "POST"
        // No Cookie and no Origin: a fresh sign-in, the request any non-browser client sends.
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = Data(body.utf8)
        let data: Data
        let response: HTTPURLResponse
        do {
            let (received, answer) = try await http.data(for: request)
            guard let answer = answer as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            data = received
            response = answer
        } catch {
            Self.log.error("native sign-in failed: \(error.localizedDescription, privacy: .public)")
            throw SignInError.unreachable(error.localizedDescription)
        }
        let reply = SignInReply(status: response.statusCode, body: String(decoding: data, as: UTF8.self))
        let fields = Self.headerFields(response)
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: fields, for: serverURL)
        // A refused sign-in (or a redirect) keeps no cookie. A success without one, such as a
        // sign-up that waits for email verification, signs nobody in: nothing to issue.
        guard (200..<300).contains(response.statusCode), !cookies.isEmpty else { return reply }

        // This sign-in replaces any earlier device session.
        if let previous = tokens {
            clear()
            _ = await post("/__farm/mobile/session/revoke", bearer: previous.refresh)
        }
        let store = WKWebsiteDataStore.default().httpCookieStore
        for cookie in cookies {
            await store.setCookie(cookie)
        }
        let header = HTTPCookie.requestHeaderFields(with: await serverCookies())["Cookie"] ?? ""
        attempted = header
        let issued = await issue(cookieHeader: header)
        guard issued == 200 else { throw SignInError.notIssued(issued) }
        return reply
    }

    /// A route under `authBasePath`, such as `/api/auth/sign-in/email`: no query, dots, or escapes.
    nonisolated static func isAuthRoute(_ path: String, authBasePath: String) -> Bool {
        guard authBasePath.hasPrefix("/"), path.hasPrefix(authBasePath + "/") else { return false }
        let rest = path.dropFirst(authBasePath.count)
        let segments = rest.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
        return segments.allSatisfy { segment in
            !segment.isEmpty && segment.unicodeScalars.allSatisfy { scalar in
                scalar.isASCII && (CharacterSet.alphanumerics.contains(scalar) || scalar == "_" || scalar == "-")
            }
        }
    }

    /// Trade the WebView's cookie session for a device token: a one-time nonce, then the exchange
    /// with the same cookies. The status of the step that answered last: 200 once stored.
    @discardableResult
    private func issue(cookieHeader: String) async -> Int {
        let challenge = await post("/__farm/mobile/session/challenge", cookies: cookieHeader)
        guard challenge.status == 200, let nonce = challenge.body?["nonce"] as? String, !nonce.isEmpty else {
            return challenge.status
        }
        let issued = await post("/__farm/mobile/session", cookies: cookieHeader, nonce: nonce)
        if issued.status == 200, let next = Self.tokens(from: issued.body) {
            save(next)
            Self.log.info("device session issued")
            return 200
        }
        return issued.status
    }

    private static func headerFields(_ response: HTTPURLResponse) -> [String: String] {
        response.allHeaderFields.reduce(into: [String: String]()) { result, entry in
            if let key = entry.key as? String, let value = entry.value as? String { result[key] = value }
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
            let store = WKWebsiteDataStore.default().httpCookieStore
            for cookie in HTTPCookie.cookies(withResponseHeaderFields: Self.headerFields(response), for: serverURL) {
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

/// The session's requests never follow a redirect: a 3xx comes back as it is, so nothing the
/// shell sends, credentials included, goes anywhere but `mobile.server`.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        nil
    }
}
