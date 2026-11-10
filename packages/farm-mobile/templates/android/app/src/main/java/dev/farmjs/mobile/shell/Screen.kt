package dev.farmjs.mobile.shell

import android.content.Context
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.core.content.ContextCompat
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.progressindicator.LinearProgressIndicator

/** One native screen: a native bar over exactly one WebView [page], or a native view. */
class Screen(
    context: Context,
    page: Page?,
    private var native: FarmNativeContent?,
    /** The module id a native or platform screen shows, such as `app/notes/[id]`. */
    val nativeModule: String?,
    val modal: Boolean,
    private val navigator: Navigator,
) : PageHost {
    /** Load the content again: the WebView page, or a native screen that can reload. */
    fun refresh() {
        page?.bridge?.refresh() ?: native?.refresh?.invoke()
    }

    /** The screen's WebView page; set later when a native screen falls back to its web twin. */
    var page: Page? = page
        private set
    var destroyed = false
        private set
    val toolbar = MaterialToolbar(context)
    private val progress = LinearProgressIndicator(context).apply {
        isIndeterminate = true
        visibility = View.GONE
    }
    private val content = FrameLayout(context)
    val view: LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(ContextCompat.getColor(context, R.color.farm_background))
        // Screens are opaque and swallow touches so the one below never sees them.
        isClickable = true
        layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    /** Called once when the page shows content for this screen (render done or first paint). */
    var onShown: ((title: String) -> Unit)? = null

    /** Called once on the first paint of a cold document load. */
    var onPainted: (() -> Unit)? = null
    private var awaitedToken = 0

    /** The route's page shell, shown over the page until it paints (or for good when offline). */
    private var shellView: WebView? = null
    private var loadFailed = false

    init {
        applyTheme()
        view.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val main = page?.webView ?: requireNotNull(native?.view) { "A screen needs a page or a native view." }
        setMain(main)
        content.addView(progress, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        view.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        page?.host = this
        if (nativeModule != null) toolbar.title = native?.title ?: nativeModule
    }

    /** This screen's chrome in the current theme: at creation, and after a theme change. */
    fun applyTheme() {
        val context = view.context
        val text = ContextCompat.getColor(context, R.color.farm_text)
        view.setBackgroundColor(ContextCompat.getColor(context, R.color.farm_background))
        toolbar.setBackgroundColor(ContextCompat.getColor(context, R.color.farm_surface))
        toolbar.setTitleTextColor(text)
        toolbar.navigationIcon?.setTint(text)
        page?.webView?.setBackgroundColor(ContextCompat.getColor(context, R.color.farm_background))
    }

    private fun setMain(main: View) {
        (main.parent as? ViewGroup)?.removeView(main)
        content.addView(main, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    /** Show the route's web screen in place of this native screen (the web twin, RFC 0004 7.10). */
    fun showWeb(page: Page, url: String, shell: String? = null) {
        if (destroyed || this.page != null) return
        native?.let {
            content.removeView(it.view)
            it.close()
        }
        native = null
        this.page = page
        setMain(page.webView)
        page.host = this
        load(url, shell)
    }

    fun setNavigation(icon: Int?, description: Int, onClick: () -> Unit) {
        if (icon == null) {
            toolbar.navigationIcon = null
            toolbar.setNavigationOnClickListener(null)
            return
        }
        toolbar.setNavigationIcon(icon)
        toolbar.navigationIcon?.setTint(ContextCompat.getColor(view.context, R.color.farm_text))
        toolbar.setNavigationContentDescription(description)
        toolbar.setNavigationOnClickListener { onClick() }
    }

    /** Warm path: render in the running page. */
    fun render(url: String) {
        val page = page ?: return
        // The warm page still shows the warm path; keep it hidden until the target renders.
        page.webView.alpha = 0f
        progress.visibility = View.VISIBLE
        awaitedToken = page.render(url)
    }

    /** Cold path: load the document, behind the route's page [shell] when it has one. */
    fun load(url: String, shell: String? = null) {
        val page = page ?: return
        progress.visibility = View.VISIBLE
        removeShell()
        loadFailed = false
        if (shell != null) {
            val view = page.createShellView(url, shell)
            // Over the page, under the progress bar.
            content.addView(view, 1)
            shellView = view
        }
        page.load(url)
    }

    private fun removeShell() {
        val view = shellView ?: return
        shellView = null
        content.removeView(view)
        view.destroy()
    }

    private fun shown(title: String) {
        progress.visibility = View.GONE
        page?.webView?.alpha = 1f
        if (title.isNotEmpty()) toolbar.title = title
        onShown?.invoke(title)
        onShown = null
    }

    override fun onVisit(page: Page, url: Uri, replace: Boolean) = navigator.visit(this, url, replace)

    override fun onRendered(page: Page, token: Int, title: String, pageMs: Double) {
        if (token == awaitedToken) shown(title)
    }

    override fun onRenderError(page: Page, token: Int, url: String) {
        // Page falls back to a document load; show it as it paints.
        if (token == awaitedToken) page.webView.alpha = 1f
    }

    override fun onCommitVisible(page: Page) {
        progress.visibility = View.GONE
        // A failed load commits the WebView's error page; the shell stays over it.
        if (!loadFailed) removeShell()
        onPainted?.invoke()
        onPainted = null
    }

    override fun onLoadError(page: Page) {
        loadFailed = true
        if (shellView != null) {
            progress.visibility = View.GONE
            android.util.Log.i(Navigator.TAG, "shell: the document did not load; keeping the page shell")
        }
    }

    override fun onRouterReady(page: Page, title: String) = shown(title)

    override fun onTitle(page: Page, title: String) {
        if (title.isNotEmpty()) toolbar.title = title
    }

    fun destroy() {
        destroyed = true
        removeShell()
        page?.destroy()
        native?.close()
        native = null
    }
}
