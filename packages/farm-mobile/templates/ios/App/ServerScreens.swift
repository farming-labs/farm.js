import UIKit
import WebKit

/// A screen whose rule is `"server"`: the analyzer proved the page needs no JavaScript, so the
/// server renders it as for a browser and answers with a tree of views (`native-tree.ts`), drawn
/// here with UIKit. Anything it cannot draw, a failed request, or an answer that is not a tree (a
/// redirect to sign in, say) shows the route's web screen instead (`fallback`).
@MainActor
final class FarmServerScreen: UIViewController {
    static let contentType = "application/vnd.farm.native+json"

    private let url: URL
    private let visit: (URL) -> Void
    private let fallback: (String) -> Void
    private let scroll = UIScrollView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var loaded = false

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
        Task { await load() }
    }

    private func load() async {
        do {
            let tree = try await fetch()
            if let unsupported = tree["unsupported"] as? [String], !unsupported.isEmpty {
                fallback("the tree cannot express \(unsupported.joined(separator: ", "))")
                return
            }
            guard let root = tree["root"] as? [String: Any] else {
                fallback("the tree has no root")
                return
            }
            let renderer = FarmTreeRenderer(page: url, visit: visit)
            let content = try renderer.node(root, parentRow: false) ?? UIView()
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
        } catch {
            fallback(String(describing: error))
        }
    }

    /// The page's tree, with the WebViews' cookies, so a signed-in page renders signed in.
    private func fetch() async throws -> [String: Any] {
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
        guard let host = url.host?.lowercased() else { return [] }
        let all = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        return all.filter { cookie in
            let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return host == domain || host.hasSuffix(".\(domain)")
        }
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

    init(page: URL, visit: @escaping (URL) -> Void) {
        self.page = page
        self.visit = visit
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
            let field = UITextField()
            field.placeholder = node["placeholder"] as? String
            field.text = node["value"] as? String
            field.font = font(style)
            field.textColor = color(of: "color", in: node) ?? Theme.text
            view = field
        case "View", "Pressable":
            view = try box(node, style: style)
        default:
            throw FarmTreeError.unexpected("node \(type)")
        }
        try decorate(view, node: node, style: style)
        if type == "Pressable", let href = node["href"] as? String, let url = URL(string: href) {
            view.isUserInteractionEnabled = true
            view.addGestureRecognizer(Tap(action: { [visit] in visit(url) }))
            view.accessibilityTraits.insert(.link)
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
