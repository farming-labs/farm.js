package dev.farmjs.mobile.shell

import android.content.Context
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.core.content.ContextCompat
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.progressindicator.LinearProgressIndicator

/** One native screen: a native bar over exactly one WebView [page], or a native view. */
class Screen(
    context: Context,
    val page: Page?,
    nativeContent: View?,
    /** The module id a native or platform screen shows, such as `app/notes/[id]`. */
    val nativeModule: String?,
    val modal: Boolean,
    private val navigator: Navigator,
) : PageHost {
    val toolbar = MaterialToolbar(context)
    private val progress = LinearProgressIndicator(context).apply {
        isIndeterminate = true
        visibility = View.GONE
    }
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

    init {
        toolbar.setBackgroundColor(ContextCompat.getColor(context, R.color.farm_surface))
        view.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val content = FrameLayout(context)
        val main = page?.webView ?: requireNotNull(nativeContent) { "A screen needs a page or a native view." }
        (main.parent as? ViewGroup)?.removeView(main)
        content.addView(main, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        content.addView(progress, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        view.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        page?.host = this
        if (nativeModule != null) toolbar.title = nativeModule
    }

    fun setNavigation(icon: Int?, description: Int, onClick: () -> Unit) {
        if (icon == null) {
            toolbar.navigationIcon = null
            toolbar.setNavigationOnClickListener(null)
            return
        }
        toolbar.setNavigationIcon(icon)
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

    /** Cold path: load the document. */
    fun load(url: String) {
        val page = page ?: return
        progress.visibility = View.VISIBLE
        page.load(url)
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
        onPainted?.invoke()
        onPainted = null
    }

    override fun onRouterReady(page: Page, title: String) = shown(title)

    override fun onTitle(page: Page, title: String) {
        if (title.isNotEmpty()) toolbar.title = title
    }

    fun destroy() {
        page?.destroy()
    }
}
