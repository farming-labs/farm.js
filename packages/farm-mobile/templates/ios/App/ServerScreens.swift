import UIKit
import WebKit
import os

/// A screen whose rule is `"server"`: the analyzer proved the page needs no JavaScript, so the
/// server renders it as for a browser and answers with a tree of views (`native-tree.ts`), drawn
/// here with UIKit. Anything it cannot draw, a failed request, or an answer that is not a tree (a
/// redirect to sign in, say) shows the route's web screen instead (`fallback`).
@MainActor
final class FarmServerScreen: UIViewController {
    static let contentType = "application/vnd.farm.native+json"

    private var url: URL
    private let visit: (URL) -> Void
    private let fallback: (String) -> Void
    private let scroll = UIScrollView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let refresher = UIRefreshControl()
    /// The tree's views in the scroll view, replaced on each draw.
    private var drawn: UIView?
    private var loaded = false
    private var submitting = false
    /// The drawn tree's forms; their fields are delegates the views do not retain.
    private var forms: [FarmFormScope] = []

    init(url: URL, visit: @escaping (URL) -> Void, fallback: @escaping (String) -> Void) {
        self.url = url
        self.visit = visit
        self.fallback = fallback
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("FarmServerScreen is created in code")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.background
        scroll.alwaysBounceVertical = true
        refresher.addAction(UIAction { [weak self] _ in self?.refresh() }, for: .valueChanged)
        scroll.refreshControl = refresher
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
        ])
        spinner.startAnimating()
        Task { await load(url) }
    }

    private func load(_ target: URL) async {
        do {
            show(try await fetch(target), url: target)
        } catch {
            fallback(String(describing: error))
        }
    }

    /// Draw a tree: the page's, or the page a submitted form's answer rendered.
    private func show(_ tree: [String: Any], url target: URL) {
        do {
            if let unsupported = tree["unsupported"] as? [String], !unsupported.isEmpty {
                fallback("the tree cannot express \(unsupported.joined(separator: ", "))")
                return
            }
            guard let root = tree["root"] as? [String: Any] else {
                fallback("the tree has no root")
                return
            }
            url = target
            let renderer = FarmTreeRenderer(page: target, visit: visit, submit: { [weak self] in self?.submit($0) })
            let content = try renderer.node(root, parentRow: false) ?? UIView()
            forms = renderer.forms
            // Only the previous tree: the scroll view also holds the refresh control, which stops
            // pulling to refresh once it leaves the view.
            drawn?.removeFromSuperview()
            drawn = content
            if let background = renderer.style(root)["backgroundColor"] {
                view.backgroundColor = renderer.color(background) ?? Theme.background
            }
            spinner.stopAnimating()
            content.translatesAutoresizingMaskIntoConstraints = false
            scroll.addSubview(content)
            NSLayoutConstraint.activate([
                content.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
                content.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
                content.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
                content.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
                content.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            ])
            // navigationItem, not title: UIViewController.title also renames a tab root's tab bar item.
            if let title = tree["title"] as? String, !title.isEmpty { parent?.navigationItem.title = title }
            loaded = true
            // Persist completion so simulator checks can distinguish a loaded tree from a pending one.
            Navigator.log.notice("server screen ready: \(self.url.path, privacy: .public)")
        } catch {
            fallback(String(describing: error))
        }
    }

    /// Pull to refresh, or a modal above it closed: load this page again over what is shown.
    func refresh() {
        guard loaded else {
            refresher.endRefreshing()
            return
        }
        let target = url
        Task {
            // A failed refresh keeps what is shown, as a browser keeps the page it had.
            if let tree = try? await fetch(target) { show(tree, url: target) }
            refresher.endRefreshing()
        }
    }

    // MARK: Forms

    private func submit(_ submission: FarmFormSubmission) {
        if submitting { return }
        if submission.method == "get" {
            go(submission.queryURL())
            return
        }
        submitting = true
        submission.setPending(true)
        Task {
            let answer: FarmFormAnswer
            do {
                answer = try await send(submission)
            } catch {
                answer = .failed("Could not reach the server. Check your connection and try again.")
            }
            submitting = false
            submission.setPending(false)
            switch answer {
            case let .redirect(location): go(location)
            case let .tree(target, tree): show(tree, url: target)
            case let .failed(message): alert(message)
            }
        }
    }

    /// This page again (a search, or a post/redirect/get) loads in place; another page is a visit.
    private func go(_ target: URL) {
        let samePage = target.scheme == url.scheme && target.host == url.host && target.port == url.port
            && (target.path.isEmpty ? "/" : target.path) == (url.path.isEmpty ? "/" : url.path)
        if samePage {
            spinner.startAnimating()
            Task { await load(target) }
        } else {
            visit(target)
        }
    }

    private func alert(_ message: String) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    /// Send a form as a browser would: its entries, the page's origin, and the WebViews' cookies.
    /// A 307 or 308 sends the body again; any other redirect is a GET the screen visits.
    private func send(_ submission: FarmFormSubmission) async throws -> FarmFormAnswer {
        var target = submission.action
        for _ in 0...5 {
            var request = URLRequest(url: target, timeoutInterval: 30)
            request.httpMethod = "POST"
            request.httpBody = submission.body
            request.setValue(FarmServerScreen.contentType, forHTTPHeaderField: "Accept")
            request.setValue(submission.contentType, forHTTPHeaderField: "Content-Type")
            request.setValue(submission.origin, forHTTPHeaderField: "Origin")
            let cookies = await FarmServerScreen.cookies(for: target)
            for (name, value) in HTTPCookie.requestHeaderFields(with: cookies) {
                request.setValue(value, forHTTPHeaderField: name)
            }
            let (data, response) = try await FarmServerScreen.http.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .failed("The server did not answer.") }
            await FarmServerScreen.store(http, for: target)
            let status = http.statusCode
            if (300...399).contains(status) {
                guard let location = http.value(forHTTPHeaderField: "Location"),
                      let next = URL(string: location, relativeTo: target)?.absoluteURL
                else { return .failed("The server answered \(status) without a location.") }
                if status == 307 || status == 308 {
                    target = next
                    continue
                }
                return .redirect(next)
            }
            let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
            // A page the server rendered for the submission, a validation error (4xx) included.
            if status < 500, type.hasPrefix(FarmServerScreen.contentType),
               let tree = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                return .tree(target, tree)
            }
            return .failed(status >= 500 ? "Something went wrong on the server (\(status)). Try again." : "The server answered \(status).")
        }
        return .failed("The server redirected too many times.")
    }

    /// Cookies a submission's answer set (a session, a flash message) go where the WebViews see them.
    static func store(_ response: HTTPURLResponse, for url: URL) async {
        let fields = response.allHeaderFields.reduce(into: [String: String]()) { fields, entry in
            if let name = entry.key as? String, let value = entry.value as? String { fields[name] = value }
        }
        let store = WKWebsiteDataStore.default().httpCookieStore
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: fields, for: url) {
            await store.setCookie(cookie)
        }
    }

    /// The page's tree, with the WebViews' cookies, so a signed-in page renders signed in.
    private func fetch(_ url: URL) async throws -> [String: Any] {
        var request = URLRequest(url: url, timeoutInterval: 30)
        request.setValue(FarmServerScreen.contentType, forHTTPHeaderField: "Accept")
        let cookies = await FarmServerScreen.cookies(for: url)
        for (name, value) in HTTPCookie.requestHeaderFields(with: cookies) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        let (data, response) = try await FarmServerScreen.http.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw FarmTreeError.unexpected("no HTTP response") }
        let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
        guard http.statusCode == 200, type.hasPrefix(FarmServerScreen.contentType) else {
            throw FarmTreeError.unexpected("the server answered \(http.statusCode) \(type)")
        }
        guard let tree = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw FarmTreeError.unexpected("the tree is not an object")
        }
        return tree
    }

    /// Requests carry only the cookies this class adds, and redirects are not followed.
    static let http: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }()

    static func cookies(for url: URL) async -> [HTTPCookie] {
        let all = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        return matchingCookies(all, for: url)
    }

    nonisolated static func matchingCookies(_ all: [HTTPCookie], for url: URL) -> [HTTPCookie] {
        // Foundation applies host-only, domain, path, Secure and expiry rules without sharing a jar.
        guard let storage = URLSessionConfiguration.ephemeral.httpCookieStorage else { return [] }
        for cookie in all { storage.setCookie(cookie) }
        return storage.cookies(for: url) ?? []
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        nil
    }
}

enum FarmTreeError: Error, CustomStringConvertible {
    case unexpected(String)

    var description: String {
        switch self {
        case let .unexpected(reason): return reason
        }
    }
}

/// One tree into views. Lengths in the tree are CSS px, drawn as points; colors resolve per
/// appearance, so the screen follows the system theme.
@MainActor
final class FarmTreeRenderer {
    static let href = NSAttributedString.Key("farmHref")
    private let page: URL
    private let visit: (URL) -> Void
    private let submit: (FarmFormSubmission) -> Void
    /// Every form drawn, and the one whose content is being drawn.
    private(set) var forms: [FarmFormScope] = []
    private var form: FarmFormScope?

    init(page: URL, visit: @escaping (URL) -> Void, submit: @escaping (FarmFormSubmission) -> Void = { _ in }) {
        self.page = page
        self.visit = visit
        self.submit = submit
    }

    func style(_ node: [String: Any]) -> [String: Any] {
        node["style"] as? [String: Any] ?? [:]
    }

    private func dark(_ node: [String: Any]) -> [String: Any] {
        node["dark"] as? [String: Any] ?? [:]
    }

    /// A color that follows the appearance: the node's dark value in dark mode.
    func color(_ light: Any?, dark: Any? = nil) -> UIColor? {
        guard let lightColor = FarmTreeRenderer.parse(light as? String) else { return nil }
        guard let darkColor = FarmTreeRenderer.parse(dark as? String) else { return lightColor }
        return UIColor { traits in traits.userInterfaceStyle == .dark ? darkColor : lightColor }
    }

    private func color(of key: String, in node: [String: Any]) -> UIColor? {
        color(style(node)[key], dark: dark(node)[key])
    }

    nonisolated static func parse(_ value: String?) -> UIColor? {
        guard let value else { return nil }
        if value == "transparent" { return .clear }
        guard value.hasPrefix("#") else { return nil }
        var hex = String(value.dropFirst())
        if hex.count == 3 || hex.count == 4 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard hex.count == 6 || hex.count == 8, let number = UInt64(hex, radix: 16) else { return nil }
        let rgba = hex.count == 6 ? (number << 8) | 0xFF : number
        return UIColor(
            red: CGFloat((rgba >> 24) & 0xFF) / 255,
            green: CGFloat((rgba >> 16) & 0xFF) / 255,
            blue: CGFloat((rgba >> 8) & 0xFF) / 255,
            alpha: CGFloat(rgba & 0xFF) / 255
        )
    }

    private func number(_ value: Any?) -> CGFloat? {
        (value as? NSNumber).map { CGFloat(truncating: $0) }
    }

    /// A length: px as points, `nil` for auto. Percentages other than 100% have no layout here.
    private func length(_ value: Any?, key: String) throws -> CGFloat? {
        if let points = number(value) { return points }
        if value == nil || value as? String == "auto" || value as? String == "100%" { return nil }
        throw FarmTreeError.unexpected("\(key) \(value ?? "")")
    }

    func node(_ node: [String: Any], parentRow: Bool) throws -> UIView? {
        let style = style(node)
        if style["display"] as? String == "none" { return nil }
        let type = node["type"] as? String ?? ""
        let outer = form
        if let formNode = node["form"] as? [String: Any] {
            let scope = FarmFormScope(form: formNode, page: page, submit: submit)
            forms.append(scope)
            form = scope
        }
        defer { form = outer }
        let scope = form
        let view: UIView
        switch type {
        case "Text":
            view = text(node)
        case "Image":
            let image = UIImageView()
            let sized = style["width"] != nil && style["height"] != nil
            image.contentMode = sized ? .scaleAspectFill : .scaleAspectFit
            image.clipsToBounds = true
            image.accessibilityLabel = node["alt"] as? String
            if let source = node["src"] as? String, let url = URL(string: source) { load(url, into: image) }
            view = image
        case "TextInput":
            guard let scope else { throw FarmTreeError.unexpected("a field outside a form") }
            view = scope.field(node, font: font(style), color: color(of: "color", in: node) ?? Theme.text)
        case "View", "Pressable":
            view = try box(node, style: style)
        default:
            throw FarmTreeError.unexpected("node \(type)")
        }
        try decorate(view, node: node, style: style)
        // What a screen reader gets, from the page's headings, labels, and hidden content.
        if let level = node["heading"] as? Int, level > 0 { view.accessibilityTraits.insert(.header) }
        if node["hidden"] as? Bool == true {
            view.accessibilityElementsHidden = true
            view.isAccessibilityElement = false
        } else if let label = node["label"] as? String, !label.isEmpty {
            view.accessibilityLabel = label
            view.isAccessibilityElement = true
        }
        if type == "Pressable", let href = node["href"] as? String, let url = URL(string: href) {
            view.isUserInteractionEnabled = true
            view.addGestureRecognizer(Tap(action: { [visit] in visit(url) }))
            view.accessibilityTraits.insert(.link)
        } else if type == "Pressable", let submitter = node["submit"] as? [String: Any], let scope {
            view.isUserInteractionEnabled = true
            scope.buttons.append((view, submitter))
            view.addGestureRecognizer(Tap(action: { [weak scope] in scope?.submit(submitter) }))
            view.accessibilityTraits.insert(.button)
        } else if type == "Pressable", node["disabled"] as? Bool == true {
            view.accessibilityTraits.insert([.button, .notEnabled])
            if style["opacity"] == nil { view.alpha = 0.5 }
        }
        return view
    }

    private func box(_ node: [String: Any], style: [String: Any]) throws -> UIView {
        let row = style["flexDirection"] as? String == "row"
        let children = try (node["children"] as? [Any] ?? []).compactMap { child -> (UIView, [String: Any])? in
            guard let child = child as? [String: Any], let view = try self.node(child, parentRow: row) else { return nil }
            return (view, self.style(child))
        }
        let box = BoxView()
        if row && style["flexWrap"] as? String == "wrap" {
            let flow = FlowView(
                columnGap: number(style["columnGap"]) ?? 0,
                rowGap: number(style["rowGap"]) ?? 0,
                centerItems: style["alignItems"] as? String == "center"
            )
            for (child, _) in children { flow.addSubview(child) }
            box.embed(flow, padding: try padding(style))
            return box
        }
        let stack = UIStackView()
        stack.axis = row ? .horizontal : .vertical
        stack.spacing = number(row ? style["columnGap"] : style["rowGap"]) ?? 0
        stack.alignment = .fill
        let justify = style["justifyContent"] as? String ?? "flex-start"
        let align = style["alignItems"] as? String ?? "stretch"
        var spacers: [UIView] = []
        func spacer() -> UIView {
            let view = UIView()
            view.setContentHuggingPriority(.init(1), for: row ? .horizontal : .vertical)
            spacers.append(view)
            return view
        }
        if justify == "center" || justify == "flex-end" { stack.addArrangedSubview(spacer()) }
        for (index, (child, childStyle)) in children.enumerated() {
            if index > 0 && (justify == "space-between" || justify == "space-around" || justify == "space-evenly") {
                stack.addArrangedSubview(spacer())
            }
            stack.addArrangedSubview(try item(child, style: childStyle, align: align, row: row))
        }
        if justify == "center" { stack.addArrangedSubview(spacer()) }
        if let first = spacers.first {
            for other in spacers.dropFirst() {
                (row ? other.widthAnchor.constraint(equalTo: first.widthAnchor) : other.heightAnchor.constraint(equalTo: first.heightAnchor)).isActive = true
            }
        }
        box.embed(stack, padding: try padding(style))
        if let maxWidth = try length(style["maxWidth"], key: "maxWidth") {
            box.widthAnchor.constraint(lessThanOrEqualToConstant: maxWidth).isActive = true
        }
        return box
    }

    /// A child in its stack slot: its margins, and where it sits on the cross axis.
    private func item(_ child: UIView, style: [String: Any], align: String, row: Bool) throws -> UIView {
        let slot = UIView()
        child.translatesAutoresizingMaskIntoConstraints = false
        slot.addSubview(child)
        let margin = { (key: String) throws -> CGFloat in try self.length(style[key], key: key) ?? 0 }
        let (top, bottom, left, right) = (try margin("marginTop"), try margin("marginBottom"), try margin("marginLeft"), try margin("marginRight"))
        let autoMargins = style["marginLeft"] as? String == "auto" && style["marginRight"] as? String == "auto"
        let alignSelf = autoMargins ? "center" : (style["alignSelf"] as? String ?? align)
        var constraints: [NSLayoutConstraint] = []
        if row {
            constraints += [
                child.leadingAnchor.constraint(equalTo: slot.leadingAnchor, constant: left),
                child.trailingAnchor.constraint(equalTo: slot.trailingAnchor, constant: -right),
            ]
            constraints += cross(child.topAnchor, child.bottomAnchor, child.centerYAnchor, slot.topAnchor, slot.bottomAnchor, slot.centerYAnchor, start: top, end: bottom, align: alignSelf, fixed: style["height"] != nil)
        } else {
            constraints += [
                child.topAnchor.constraint(equalTo: slot.topAnchor, constant: top),
                child.bottomAnchor.constraint(equalTo: slot.bottomAnchor, constant: -bottom),
            ]
            constraints += cross(child.leadingAnchor, child.trailingAnchor, child.centerXAnchor, slot.leadingAnchor, slot.trailingAnchor, slot.centerXAnchor, start: left, end: right, align: alignSelf, fixed: style["width"] != nil || style["maxWidth"] != nil)
        }
        if let width = try length(style["width"], key: "width") { constraints.append(child.widthAnchor.constraint(equalToConstant: width)) }
        if let height = try length(style["height"], key: "height") { constraints.append(child.heightAnchor.constraint(equalToConstant: height)) }
        if let minHeight = try length(style["minHeight"], key: "minHeight") { constraints.append(child.heightAnchor.constraint(greaterThanOrEqualToConstant: minHeight)) }
        if let minWidth = try length(style["minWidth"], key: "minWidth") { constraints.append(child.widthAnchor.constraint(greaterThanOrEqualToConstant: minWidth)) }
        NSLayoutConstraint.activate(constraints)
        let grow = number(style["flexGrow"]) ?? 0
        slot.setContentHuggingPriority(grow > 0 ? .init(2) : .defaultHigh, for: row ? .horizontal : .vertical)
        return slot
    }

    // swiftlint:disable:next function_parameter_count
    private func cross(
        _ start: NSLayoutXAxisAnchor, _ end: NSLayoutXAxisAnchor, _ center: NSLayoutXAxisAnchor,
        _ slotStart: NSLayoutXAxisAnchor, _ slotEnd: NSLayoutXAxisAnchor, _ slotCenter: NSLayoutXAxisAnchor,
        start startInset: CGFloat, end endInset: CGFloat, align: String, fixed: Bool
    ) -> [NSLayoutConstraint] {
        crossConstraints(
            start.constraint(equalTo: slotStart, constant: startInset),
            start.constraint(greaterThanOrEqualTo: slotStart, constant: startInset),
            end.constraint(equalTo: slotEnd, constant: -endInset),
            end.constraint(lessThanOrEqualTo: slotEnd, constant: -endInset),
            center.constraint(equalTo: slotCenter),
            align: align,
            fixed: fixed
        )
    }

    // swiftlint:disable:next function_parameter_count
    private func cross(
        _ start: NSLayoutYAxisAnchor, _ end: NSLayoutYAxisAnchor, _ center: NSLayoutYAxisAnchor,
        _ slotStart: NSLayoutYAxisAnchor, _ slotEnd: NSLayoutYAxisAnchor, _ slotCenter: NSLayoutYAxisAnchor,
        start startInset: CGFloat, end endInset: CGFloat, align: String, fixed: Bool
    ) -> [NSLayoutConstraint] {
        crossConstraints(
            start.constraint(equalTo: slotStart, constant: startInset),
            start.constraint(greaterThanOrEqualTo: slotStart, constant: startInset),
            end.constraint(equalTo: slotEnd, constant: -endInset),
            end.constraint(lessThanOrEqualTo: slotEnd, constant: -endInset),
            center.constraint(equalTo: slotCenter),
            align: align,
            fixed: fixed
        )
    }

    /// `stretch`, the default, fills the cross axis unless the child sets its size; the others
    /// pin one side, or the center, and let the child keep its size.
    private func crossConstraints(
        _ pinStart: NSLayoutConstraint, _ floatStart: NSLayoutConstraint,
        _ pinEnd: NSLayoutConstraint, _ floatEnd: NSLayoutConstraint,
        _ center: NSLayoutConstraint, align: String, fixed: Bool
    ) -> [NSLayoutConstraint] {
        switch align {
        case "center":
            return [center, floatStart, floatEnd]
        case "flex-end":
            return [pinEnd, floatStart]
        case "flex-start", "baseline":
            return [pinStart, floatEnd]
        default:
            if fixed {
                // A fixed or capped size wins over stretching: centered like `mx-auto`, else at the start.
                pinStart.priority = .defaultHigh
                pinEnd.priority = .defaultHigh
                return [pinStart, pinEnd, floatStart, floatEnd]
            }
            return [pinStart, pinEnd]
        }
    }

    private func padding(_ style: [String: Any]) throws -> UIEdgeInsets {
        UIEdgeInsets(
            top: try length(style["paddingTop"], key: "paddingTop") ?? 0,
            left: try length(style["paddingLeft"], key: "paddingLeft") ?? 0,
            bottom: try length(style["paddingBottom"], key: "paddingBottom") ?? 0,
            right: try length(style["paddingRight"], key: "paddingRight") ?? 0
        )
    }

    /// Background, borders, radius, opacity, clipping, and a text box's padding.
    private func decorate(_ view: UIView, node: [String: Any], style: [String: Any]) throws {
        if let background = color(of: "backgroundColor", in: node) { view.backgroundColor = background }
        if let opacity = number(style["opacity"]) { view.alpha = opacity }
        let radius = number(style["borderTopLeftRadius"]) ?? 0
        if radius > 0 {
            view.layer.cornerRadius = min(radius, 9999)
            view.layer.cornerCurve = .continuous
            if view is UIImageView || style["overflow"] as? String == "hidden" { view.clipsToBounds = true }
        }
        if style["overflow"] as? String == "hidden" { view.clipsToBounds = true }
        let sides = ["Top", "Right", "Bottom", "Left"].map { side in
            (side, number(style["border\(side)Width"]) ?? 0, color(of: "border\(side)Color", in: node) ?? Theme.text)
        }
        let widths = Set(sides.map(\.1))
        if widths.count == 1, let width = widths.first, width > 0 {
            (view as? BoxView)?.border(width: width, color: sides[0].2) ?? {
                view.layer.borderWidth = width
                view.layer.borderColor = sides[0].2.cgColor
            }()
        } else if sides.contains(where: { $0.1 > 0 }) {
            guard let box = view as? BoxView else { throw FarmTreeError.unexpected("per-side borders on a non-box") }
            for (side, width, color) in sides where width > 0 { box.edge(side, width: width, color: color) }
        }
        if let label = view as? FarmLabel {
            label.insets = try padding(style)
        }
    }

    // MARK: Text

    private func font(_ style: [String: Any]) -> UIFont {
        let size = number(style["fontSize"]) ?? 16
        let weightValue = number(style["fontWeight"]) ?? 400
        let weight: UIFont.Weight = switch weightValue {
        case ..<150: .ultraLight
        case ..<250: .thin
        case ..<350: .light
        case ..<450: .regular
        case ..<550: .medium
        case ..<650: .semibold
        case ..<750: .bold
        case ..<850: .heavy
        default: .black
        }
        var font: UIFont = switch style["fontFamily"] as? String {
        case "mono": .monospacedSystemFont(ofSize: size, weight: weight)
        case "serif":
            UIFont.systemFont(ofSize: size, weight: weight).fontDescriptor.withDesign(.serif)
                .map { UIFont(descriptor: $0, size: size) } ?? .systemFont(ofSize: size, weight: weight)
        default: .systemFont(ofSize: size, weight: weight)
        }
        if style["fontStyle"] as? String == "italic", let italic = font.fontDescriptor.withSymbolicTraits(.traitItalic) {
            font = UIFont(descriptor: italic, size: size)
        }
        return font
    }

    private func attributes(_ node: [String: Any], base: [NSAttributedString.Key: Any]) -> [NSAttributedString.Key: Any] {
        let style = style(node)
        var attributes = base
        if style["fontSize"] != nil || style["fontWeight"] != nil || style["fontStyle"] != nil || style["fontFamily"] != nil {
            let current = base[.font] as? UIFont
            var merged: [String: Any] = [:]
            if let current {
                merged["fontSize"] = current.pointSize
                if current.fontDescriptor.symbolicTraits.contains(.traitBold) { merged["fontWeight"] = 700 }
                if current.fontDescriptor.symbolicTraits.contains(.traitItalic) { merged["fontStyle"] = "italic" }
            }
            attributes[.font] = font(merged.merging(style) { _, new in new })
        }
        if let color = color(of: "color", in: node) { attributes[.foregroundColor] = color }
        if let tracking = number(style["letterSpacing"]), let font = attributes[.font] as? UIFont {
            attributes[.kern] = tracking * font.pointSize
        }
        switch style["textDecorationLine"] as? String {
        case "underline": attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue
        case "line-through": attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
        case "none":
            attributes[.underlineStyle] = nil
            attributes[.strikethroughStyle] = nil
        default: break
        }
        if let href = node["href"] as? String { attributes[FarmTreeRenderer.href] = href }
        return attributes
    }

    private func text(_ node: [String: Any]) -> UIView {
        let style = style(node)
        let label = FarmLabel()
        label.numberOfLines = 0
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = switch style["textAlign"] as? String {
        case "center": .center
        case "right": .right
        case "justify": .justified
        default: .natural
        }
        if let lineHeight = number(style["lineHeight"]) {
            paragraph.minimumLineHeight = lineHeight
            paragraph.maximumLineHeight = lineHeight
        }
        let base = attributes(node, base: [
            .font: font(style),
            .foregroundColor: Theme.text,
            .paragraphStyle: paragraph,
        ])
        let content = NSMutableAttributedString()
        runs(node["children"] as? [Any] ?? [], base: base, transform: style["textTransform"] as? String, into: content)
        if let lineHeight = number(style["lineHeight"]), let font = base[.font] as? UIFont {
            // Center the glyphs in the line, as CSS does.
            content.addAttribute(.baselineOffset, value: (lineHeight - font.lineHeight) / 4, range: NSRange(location: 0, length: content.length))
        }
        label.attributedText = content
        var hasLink = false
        content.enumerateAttribute(FarmTreeRenderer.href, in: NSRange(location: 0, length: content.length)) { value, _, stop in
            if value != nil {
                hasLink = true
                stop.pointee = true
            }
        }
        if hasLink {
            label.isUserInteractionEnabled = true
            label.addGestureRecognizer(Tap(action: { [weak label, visit, page] in
                guard let label, let href = label.link(at: label.lastTap), let url = URL(string: href, relativeTo: page) else { return }
                visit(url.absoluteURL)
            }))
        }
        return label
    }

    private func runs(_ children: [Any], base: [NSAttributedString.Key: Any], transform: String?, into content: NSMutableAttributedString) {
        for child in children {
            if let string = child as? String {
                let shown = switch transform {
                case "uppercase": string.uppercased()
                case "lowercase": string.lowercased()
                case "capitalize": string.capitalized
                default: string
                }
                content.append(NSAttributedString(string: shown, attributes: base))
            } else if let run = child as? [String: Any] {
                let style = style(run)
                runs(
                    run["children"] as? [Any] ?? [],
                    base: attributes(run, base: base),
                    transform: style["textTransform"] as? String ?? transform,
                    into: content
                )
            }
        }
    }

    // MARK: Images

    private func load(_ url: URL, into image: UIImageView) {
        Task { [weak image] in
            var request = URLRequest(url: url)
            let cookies = await FarmServerScreen.cookies(for: url)
            for (name, value) in HTTPCookie.requestHeaderFields(with: cookies) {
                request.setValue(value, forHTTPHeaderField: name)
            }
            guard let (data, _) = try? await FarmServerScreen.http.data(for: request), let loaded = UIImage(data: data) else { return }
            image?.image = loaded
            image?.invalidateIntrinsicContentSize()
        }
    }
}

/// A tap that runs a closure.
private final class Tap: UITapGestureRecognizer {
    private let action: () -> Void

    init(action: @escaping () -> Void) {
        self.action = action
        super.init(target: nil, action: nil)
        addTarget(self, action: #selector(fire))
    }

    @objc private func fire() {
        if let label = view as? FarmLabel { label.lastTap = location(in: label) }
        action()
    }
}

/// A box: a background, borders, padding around one content view.
private final class BoxView: UIView {
    func embed(_ content: UIView, padding: UIEdgeInsets) {
        content.translatesAutoresizingMaskIntoConstraints = false
        addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: topAnchor, constant: padding.top),
            content.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -padding.bottom),
            content.leadingAnchor.constraint(equalTo: leadingAnchor, constant: padding.left),
            content.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -padding.right),
        ])
    }

    private var borderColor: UIColor?

    func border(width: CGFloat, color: UIColor) {
        layer.borderWidth = width
        borderColor = color
        layer.borderColor = color.resolvedColor(with: traitCollection).cgColor
        if #available(iOS 17.0, *) {
            registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (box: BoxView, _: UITraitCollection) in
                box.layer.borderColor = box.borderColor?.resolvedColor(with: box.traitCollection).cgColor
            }
        }
    }

    /// A border on one side, such as a divider: a hairline view along that edge.
    func edge(_ side: String, width: CGFloat, color: UIColor) {
        let line = UIView()
        line.backgroundColor = color
        line.translatesAutoresizingMaskIntoConstraints = false
        addSubview(line)
        var constraints: [NSLayoutConstraint] = []
        switch side {
        case "Top", "Bottom":
            constraints = [
                line.leadingAnchor.constraint(equalTo: leadingAnchor),
                line.trailingAnchor.constraint(equalTo: trailingAnchor),
                line.heightAnchor.constraint(equalToConstant: width),
                side == "Top" ? line.topAnchor.constraint(equalTo: topAnchor) : line.bottomAnchor.constraint(equalTo: bottomAnchor),
            ]
        default:
            constraints = [
                line.topAnchor.constraint(equalTo: topAnchor),
                line.bottomAnchor.constraint(equalTo: bottomAnchor),
                line.widthAnchor.constraint(equalToConstant: width),
                side == "Left" ? line.leadingAnchor.constraint(equalTo: leadingAnchor) : line.trailingAnchor.constraint(equalTo: trailingAnchor),
            ]
        }
        NSLayoutConstraint.activate(constraints)
    }
}

/// A label with padding, and the link under a tap.
final class FarmLabel: UILabel {
    var insets: UIEdgeInsets = .zero {
        didSet { invalidateIntrinsicContentSize() }
    }
    var lastTap: CGPoint = .zero

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }

    override func textRect(forBounds bounds: CGRect, limitedToNumberOfLines numberOfLines: Int) -> CGRect {
        let inner = super.textRect(forBounds: bounds.inset(by: insets), limitedToNumberOfLines: numberOfLines)
        return inner.inset(by: UIEdgeInsets(top: -insets.top, left: -insets.left, bottom: -insets.bottom, right: -insets.right))
    }

    /// The `farmHref` of the character at `point`, laid out as the label lays it out.
    func link(at point: CGPoint) -> String? {
        guard let text = attributedText, text.length > 0 else { return nil }
        let storage = NSTextStorage(attributedString: text)
        let layout = NSLayoutManager()
        let container = NSTextContainer(size: bounds.inset(by: insets).size)
        container.lineFragmentPadding = 0
        container.maximumNumberOfLines = numberOfLines
        container.lineBreakMode = lineBreakMode
        layout.addTextContainer(container)
        storage.addLayoutManager(layout)
        let inside = CGPoint(x: point.x - insets.left, y: point.y - insets.top)
        let index = layout.characterIndex(for: inside, in: container, fractionOfDistanceBetweenInsertionPoints: nil)
        guard index < text.length else { return nil }
        return text.attribute(FarmTreeRenderer.href, at: index, effectiveRange: nil) as? String
    }
}

/// Children in rows that wrap, as a wrapping flex row does.
private final class FlowView: UIView {
    private let columnGap: CGFloat
    private let rowGap: CGFloat
    private let centerItems: Bool
    private var laidOutWidth: CGFloat = 0
    private var height: CGFloat = 0

    init(columnGap: CGFloat, rowGap: CGFloat, centerItems: Bool) {
        self.columnGap = columnGap
        self.rowGap = rowGap
        self.centerItems = centerItems
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("FlowView is created in code")
    }

    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: height)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let width = bounds.width
        var lines: [[(UIView, CGSize)]] = [[]]
        var x: CGFloat = 0
        for child in subviews {
            let size = child.systemLayoutSizeFitting(
                CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
                withHorizontalFittingPriority: .fittingSizeLevel,
                verticalFittingPriority: .fittingSizeLevel
            )
            let clamped = CGSize(width: min(size.width, width), height: size.height)
            if !lines[lines.count - 1].isEmpty && x + columnGap + clamped.width > width {
                lines.append([])
                x = 0
            }
            if !lines[lines.count - 1].isEmpty { x += columnGap }
            lines[lines.count - 1].append((child, clamped))
            x += clamped.width
        }
        var y: CGFloat = 0
        for line in lines where !line.isEmpty {
            let lineHeight = line.map(\.1.height).max() ?? 0
            var left: CGFloat = 0
            for (child, size) in line {
                let top = centerItems ? (lineHeight - size.height) / 2 : 0
                child.frame = CGRect(x: left, y: y + top, width: size.width, height: size.height)
                left += size.width + columnGap
            }
            y += lineHeight + rowGap
        }
        let total = max(0, y - rowGap)
        if total != height || width != laidOutWidth {
            height = total
            laidOutWidth = width
            invalidateIntrinsicContentSize()
        }
    }
}

// MARK: - Forms

/// One `<form>` of a server screen: its fields and submit buttons, and how a tap sends them.
@MainActor
final class FarmFormScope: NSObject, UITextFieldDelegate {
    private struct Field {
        let name: String
        let read: () -> String
        let view: UIView
        let required: Bool
        let disabled: Bool
    }

    private let form: [String: Any]
    private let page: URL
    private let onSubmit: (FarmFormSubmission) -> Void
    private var fields: [Field] = []
    private var maxLengths: [ObjectIdentifier: Int] = [:]
    var buttons: [(UIView, [String: Any])] = []

    init(form: [String: Any], page: URL, submit: @escaping (FarmFormSubmission) -> Void) {
        self.form = form
        self.page = page
        self.onSubmit = submit
    }

    func field(_ node: [String: Any], font: UIFont, color: UIColor) -> UIView {
        let disabled = node["disabled"] as? Bool == true
        let readOnly = node["readOnly"] as? Bool == true
        let name = node["name"] as? String ?? ""
        let required = node["required"] as? Bool == true
        if node["multiline"] as? Bool == true {
            let area = UITextView()
            area.text = node["value"] as? String
            area.font = font
            area.textColor = color
            area.backgroundColor = .clear
            area.isScrollEnabled = false
            area.isEditable = !disabled && !readOnly
            area.heightAnchor.constraint(greaterThanOrEqualToConstant: font.lineHeight * 3).isActive = true
            fields.append(Field(name: name, read: { [weak area] in area?.text ?? "" }, view: area, required: required, disabled: disabled))
            return area
        }
        let field = UITextField()
        field.placeholder = node["placeholder"] as? String
        field.text = node["value"] as? String
        field.font = font
        field.textColor = color
        field.delegate = self
        field.isEnabled = !disabled && !readOnly
        // Return submits the form, as Enter does in a browser.
        field.returnKeyType = .go
        switch node["inputType"] as? String {
        case "email":
            field.keyboardType = .emailAddress
            field.autocapitalizationType = .none
            field.textContentType = .emailAddress
        case "password":
            field.isSecureTextEntry = true
            field.textContentType = .password
        case "number": field.keyboardType = .decimalPad
        case "tel": field.keyboardType = .phonePad
        case "url":
            field.keyboardType = .URL
            field.autocapitalizationType = .none
        case "search": field.returnKeyType = .search
        default: break
        }
        if let maxLength = node["maxLength"] as? Int { maxLengths[ObjectIdentifier(field)] = maxLength }
        fields.append(Field(name: name, read: { [weak field] in field?.text ?? "" }, view: field, required: required, disabled: disabled))
        return field
    }

    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        guard let maxLength = maxLengths[ObjectIdentifier(textField)] else { return true }
        let current = (textField.text ?? "") as NSString
        return current.replacingCharacters(in: range, with: string).count <= maxLength
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        // The form's first submit button, or the form itself when it has one field.
        if let first = buttons.first { submit(first.1) } else if fields.count == 1 { submit(nil) }
        return false
    }

    func submit(_ submitter: [String: Any]?) {
        // A required field left empty stops the submission, as a browser's validation does.
        if let empty = fields.first(where: { $0.required && !$0.disabled && $0.read().isEmpty }) {
            empty.view.becomeFirstResponder()
            empty.view.layer.borderColor = UIColor.systemRed.cgColor
            empty.view.layer.borderWidth = 1
            return
        }
        var entries: [(String, String)] = []
        for hidden in form["fields"] as? [[String: Any]] ?? [] {
            if let name = hidden["name"] as? String { entries.append((name, hidden["value"] as? String ?? "")) }
        }
        for field in fields where !field.name.isEmpty && !field.disabled {
            entries.append((field.name, field.read()))
        }
        if let name = submitter?["name"] as? String { entries.append((name, submitter?["value"] as? String ?? "")) }
        func option(_ key: String) -> String? {
            (submitter?[key] as? String).flatMap { $0.isEmpty ? nil : $0 }
                ?? (form[key] as? String).flatMap { $0.isEmpty ? nil : $0 }
        }
        let origin = "\(page.scheme ?? "https")://\(page.host ?? "")" + (page.port.map { ":\($0)" } ?? "")
        let buttons = self.buttons.map { $0.0 }
        onSubmit(FarmFormSubmission(
            action: option("action").flatMap { URL(string: $0) } ?? page,
            method: option("method") ?? "get",
            enctype: option("enctype") ?? "application/x-www-form-urlencoded",
            entries: entries,
            origin: origin,
            setPending: { pending in
                for button in buttons {
                    button.isUserInteractionEnabled = !pending
                    button.alpha = pending ? 0.5 : 1
                }
            }
        ))
    }
}

/// A form's entries, ready to send as HTML's form submission algorithm would.
@MainActor
struct FarmFormSubmission {
    let action: URL
    let method: String
    let enctype: String
    let entries: [(String, String)]
    let origin: String
    let setPending: (Bool) -> Void
    private let boundary = "----FarmFormBoundary" + UUID().uuidString.replacingOccurrences(of: "-", with: "")

    init(action: URL, method: String, enctype: String, entries: [(String, String)], origin: String, setPending: @escaping (Bool) -> Void) {
        self.action = action
        self.method = method
        self.enctype = enctype
        // Newlines in names and values are sent as CRLF.
        self.entries = entries.map { (FarmFormSubmission.crlf($0.0), FarmFormSubmission.crlf($0.1)) }
        self.origin = origin
        self.setPending = setPending
    }

    private static func crlf(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\n", with: "\r\n")
    }

    private var multipart: Bool { enctype == "multipart/form-data" }

    var contentType: String {
        multipart ? "multipart/form-data; boundary=\(boundary)" : "application/x-www-form-urlencoded;charset=UTF-8"
    }

    var body: Data {
        if !multipart { return Data(urlencoded().utf8) }
        var out = ""
        for (name, value) in entries {
            let escaped = name.replacingOccurrences(of: "\"", with: "%22")
                .replacingOccurrences(of: "\r", with: "%0D").replacingOccurrences(of: "\n", with: "%0A")
            out += "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(escaped)\"\r\n\r\n\(value)\r\n"
        }
        out += "--\(boundary)--\r\n"
        return Data(out.utf8)
    }

    /// A GET form replaces the action's query with its entries.
    func queryURL() -> URL {
        guard var components = URLComponents(url: action, resolvingAgainstBaseURL: false) else { return action }
        let query = urlencoded()
        components.percentEncodedQuery = query.isEmpty ? nil : query
        return components.url ?? action
    }

    /// application/x-www-form-urlencoded: unreserved characters stay, a space is "+".
    private func urlencoded() -> String {
        // ASCII only: every other character is sent as its UTF-8 bytes, percent-encoded.
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789*-._ ")
        func encode(_ text: String) -> String {
            (text.addingPercentEncoding(withAllowedCharacters: allowed) ?? "").replacingOccurrences(of: " ", with: "+")
        }
        return entries.map { "\(encode($0.0))=\(encode($0.1))" }.joined(separator: "&")
    }
}

enum FarmFormAnswer {
    case redirect(URL)
    case tree(URL, [String: Any])
    case failed(String)
}
