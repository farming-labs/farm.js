import UIKit

/// One native screen: a navigation bar over exactly one WebView `page`, or a native view
/// controller for a `"native"` or `"platform"` rule.
@MainActor
final class ScreenViewController: UIViewController, PageHost {
    let page: Page?
    /// The module id a native or platform screen shows, such as `app/notes/[id]`.
    let nativeModule: String?
    let isModal: Bool
    /// Taken from the warm pool with the Farm router already running.
    let isWarm: Bool
    private let nativeContent: UIViewController?
    private weak var navigator: Navigator?

    private let progress = UIActivityIndicatorView(style: .medium)
    private let failure = UIStackView()
    private let failureLabel = UILabel()

    /// Called once when the page shows content for this screen (render done or router ready).
    var onShown: ((String) -> Void)?
    /// Called once when a cold document load commits.
    var onPainted: (() -> Void)?
    private var awaitedToken = 0

    init(
        page: Page?,
        nativeContent: UIViewController?,
        nativeModule: String?,
        isModal: Bool,
        isWarm: Bool,
        navigator: Navigator
    ) {
        precondition(page != nil || nativeContent != nil, "A screen needs a page or a native view.")
        self.page = page
        self.nativeContent = nativeContent
        self.nativeModule = nativeModule
        self.isModal = isModal
        self.isWarm = isWarm
        self.navigator = navigator
        super.init(nibName: nil, bundle: nil)
        page?.host = self
        if let nativeModule { navigationItem.title = nativeModule }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("ScreenViewController is created in code")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.background
        navigationItem.largeTitleDisplayMode = .never
        let content: UIView
        if let page {
            // A warm page leaves the pool's holder here, without reloading.
            content = page.webView
        } else if let nativeContent {
            addChild(nativeContent)
            content = nativeContent.view
        } else {
            return
        }
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            content.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        nativeContent?.didMove(toParent: self)

        progress.translatesAutoresizingMaskIntoConstraints = false
        progress.hidesWhenStopped = true
        view.addSubview(progress)

        failureLabel.numberOfLines = 0
        failureLabel.textAlignment = .center
        failureLabel.textColor = Theme.text
        failureLabel.font = .preferredFont(forTextStyle: .body)
        let retry = UIButton(type: .system, primaryAction: UIAction(title: "Try Again") { [weak self] _ in
            self?.retry()
        })
        failure.axis = .vertical
        failure.spacing = 12
        failure.alignment = .center
        failure.isHidden = true
        failure.translatesAutoresizingMaskIntoConstraints = false
        failure.addArrangedSubview(failureLabel)
        failure.addArrangedSubview(retry)
        view.addSubview(failure)

        NSLayoutConstraint.activate([
            progress.centerXAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerXAnchor),
            progress.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            failure.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            failure.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            failure.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
        ])
        if page != nil && onShown != nil { progress.startAnimating() }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        // Popped, or its modal closed: the WebView goes now instead of whenever ARC gets to it.
        if isMovingFromParent || isBeingDismissed || navigationController?.isBeingDismissed == true {
            page?.destroy()
        }
    }

    /// Warm path: render in the running page.
    func render(_ url: URL) {
        guard let page else { return }
        // The warm page still shows the warm path; keep it hidden until the target renders.
        page.webView.alpha = 0
        if isViewLoaded { progress.startAnimating() }
        awaitedToken = page.render(url)
    }

    /// Cold path: load the document, behind the route's page `shell` when it has one.
    func load(_ url: URL, shell: String? = nil) {
        guard let page else { return }
        if isViewLoaded { progress.startAnimating() }
        page.load(url, shell: shell)
    }

    private func retry() {
        failure.isHidden = true
        guard let page, let url = page.lastURL else { return }
        progress.startAnimating()
        page.load(url)
    }

    private func shown(_ title: String) {
        progress.stopAnimating()
        page?.webView.alpha = 1
        if !title.isEmpty { navigationItem.title = title }
        let shown = onShown
        onShown = nil
        shown?(title)
    }

    // MARK: PageHost

    func page(_ page: Page, visit url: URL, replace: Bool) {
        navigator?.visit(from: self, url: url, replace: replace)
    }

    func page(_ page: Page, rendered token: Int, title: String, pageMs: Double) {
        if token == awaitedToken { shown(title) }
    }

    func page(_ page: Page, renderError token: Int, url: String) {
        // The page falls back to a document load; show it as it paints.
        if token == awaitedToken { page.webView.alpha = 1 }
    }

    func pageCommitted(_ page: Page) {
        failure.isHidden = true
        progress.stopAnimating()
        page.webView.alpha = 1
        let painted = onPainted
        onPainted = nil
        painted?()
    }

    func pageShowsShell(_ page: Page) {
        // The shell is the loading state; a spinner over it would be a second one.
        progress.stopAnimating()
        page.webView.alpha = 1
    }

    func pageRouterReady(_ page: Page, title: String) {
        shown(title)
    }

    func page(_ page: Page, title: String) {
        if !title.isEmpty { navigationItem.title = title }
    }

    func page(_ page: Page, failed error: Error) {
        progress.stopAnimating()
        page.webView.alpha = 1
        failureLabel.text = error.localizedDescription
        failure.isHidden = false
        view.bringSubviewToFront(failure)
    }

    func pageTerminated(_ page: Page) {
        if isViewLoaded { progress.startAnimating() }
    }
}
