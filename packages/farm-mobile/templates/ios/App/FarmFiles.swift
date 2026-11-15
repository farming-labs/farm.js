import Foundation
import Security
import UniformTypeIdentifiers

/// Files web screens get by reference (RFC 0004, 7.5), the twin of Android's FarmFiles.kt. A
/// native module writes a large result, such as a photo, into `tmp/farm-files` and resolves with
/// its `file://` URL, as a React Native module does for native screens. On its way to a web page
/// the bridge swaps that URL for a `/__farm/files/<id>` reference and sends the file's bytes with
/// the answer: WKWebView cannot answer requests to the app's `https` origin the way Android's
/// WebView does, so the bridge script turns the bytes into a `blob:` URL the page loads like any
/// URL (`<img src>`, `fetch`).
///
/// One instance per WebView, so a reference works only in the page that received it. The page
/// passes it back as an argument and the module gets the `file://` URL again. When the page closes
/// its references stop working and its files are deleted. Only files inside the directory are ever
/// shared, so a module that echoes a string cannot expose other app files.
@MainActor
final class FarmFiles {
    /// A file larger than this is not copied into a page.
    nonisolated static let maxBytes = 64 * 1024 * 1024
    private static let prefix = "/__farm/files/"

    /// Every open page's store, to keep a file another page still holds.
    private static var pages: [ObjectIdentifier: FarmFiles] = [:]

    /// This page's references: id to standardized file URL.
    private var files: [String: URL] = [:]
    private var closed = false

    init() {
        FarmFiles.pages[ObjectIdentifier(self)] = self
    }

    /// Where a module writes files for web screens: `tmp/farm-files`, by that name, since app
    /// modules build without the shell's classes. Farm owns it: files a page received are deleted
    /// when the page closes, and the rest when the app starts again.
    nonisolated static var directory: URL {
        URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("farm-files", isDirectory: true)
            .resolvingSymlinksInPath()
    }

    /// A result on its way to the page: `file://` URLs inside the directory become references, and
    /// `bytes` holds each one's type and base64 contents for the bridge script.
    func share(_ value: Any) throws -> (value: Any, bytes: [String: [String: String]]) {
        var bytes: [String: [String: String]] = [:]
        let shared = try share(value, into: &bytes)
        return (shared, bytes)
    }

    private func share(_ value: Any, into bytes: inout [String: [String: String]]) throws -> Any {
        switch value {
        case let text as String:
            guard !closed, let file = FarmFiles.file(in: text) else { return text }
            let reference = self.reference(file)
            if bytes[reference] == nil {
                let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                guard size <= FarmFiles.maxBytes else {
                    throw FarmCallError(
                        code: "native_error",
                        message: "\(file.lastPathComponent) is \(size) bytes; web screens take files up to \(FarmFiles.maxBytes) bytes."
                    )
                }
                guard let data = try? Data(contentsOf: file) else { return text }
                bytes[reference] = ["type": FarmFiles.type(of: file), "data": data.base64EncodedString()]
            }
            return reference
        case let list as [Any]:
            return try list.map { try share($0, into: &bytes) }
        case let object as [String: Any]:
            return try object.mapValues { try share($0, into: &bytes) }
        default:
            return value
        }
    }

    /// A call's arguments on their way to a module: this page's references become `file://` URLs
    /// again. Throws `invalid_args` for a reference this page never received.
    func resolve(_ value: Any?) throws -> Any? {
        switch value {
        case let text as String:
            guard text.hasPrefix(FarmFiles.prefix) else { return text }
            let id = String(text.dropFirst(FarmFiles.prefix.count))
            guard FarmFiles.isId(id) else { return text }
            guard let file = files[id] else {
                throw FarmCallError(code: "invalid_args", message: "\(text) is not a file this screen received.")
            }
            return file.absoluteString
        case let list as [Any]:
            return try list.map { try resolve($0) ?? NSNull() }
        case let object as [String: Any]:
            return try object.mapValues { try resolve($0) ?? NSNull() }
        default:
            return value
        }
    }

    /// The page closed: its references stop working, and files no other page holds are deleted.
    func close() {
        guard !closed else { return }
        closed = true
        FarmFiles.pages[ObjectIdentifier(self)] = nil
        let held = Set(files.values)
        files.removeAll()
        let others = Set(FarmFiles.pages.values.flatMap { $0.files.values })
        for file in held where !others.contains(file) {
            try? FileManager.default.removeItem(at: file)
        }
    }

    private func reference(_ file: URL) -> String {
        if let id = files.first(where: { $0.value == file })?.key { return FarmFiles.prefix + id }
        var random = [UInt8](repeating: 0, count: 16)
        if SecRandomCopyBytes(kSecRandomDefault, random.count, &random) != errSecSuccess {
            random = (0..<16).map { _ in UInt8.random(in: 0...255) }
        }
        let id = Data(random).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        files[id] = file
        return FarmFiles.prefix + id
    }

    private static func isId(_ id: String) -> Bool {
        id.count == 22 && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }

    /// The standardized file a `file://` URL names, when it is a file inside the directory.
    private static func file(in value: String) -> URL? {
        guard value.hasPrefix("file:"), let url = URL(string: value), url.isFileURL else { return nil }
        let file = url.standardizedFileURL.resolvingSymlinksInPath()
        let root = directory.path + "/"
        var isDirectory: ObjCBool = false
        guard file.path.hasPrefix(root),
              FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory),
              !isDirectory.boolValue
        else { return nil }
        return file
    }

    private static func type(of file: URL) -> String {
        UTType(filenameExtension: file.pathExtension.lowercased())?.preferredMIMEType ?? "application/octet-stream"
    }

    /// Main thread only: whether this process already cleared files from an earlier run.
    private static var cleared = false

    /// At launch: delete the files an earlier run of the app left, off the main thread.
    static func clearStale() {
        guard !cleared else { return }
        cleared = true
        let startedAt = Date()
        let dir = directory
        DispatchQueue.global(qos: .utility).async {
            let manager = FileManager.default
            let entries = (try? manager.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: [.contentModificationDateKey]
            )) ?? []
            for entry in entries {
                let modified = (try? entry.resourceValues(forKeys: [.contentModificationDateKey]))?
                    .contentModificationDate ?? .distantPast
                if modified < startedAt { try? manager.removeItem(at: entry) }
            }
        }
    }
}
