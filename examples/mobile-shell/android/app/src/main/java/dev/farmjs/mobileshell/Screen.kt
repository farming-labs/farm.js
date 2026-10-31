package dev.farmjs.mobileshell

import android.content.Context
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.core.content.ContextCompat
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.appbar.MaterialToolbar

/** One native screen: a native bar over exactly one WebView. */
class Screen(
    context: Context,
    val page: Page,
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
    private var awaitedToken = 0

    init {
        toolbar.setBackgroundColor(ContextCompat.getColor(context, R.color.farm_surface))
        view.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val content = FrameLayout(context)
        (page.webView.parent as? ViewGroup)?.removeView(page.webView)
        content.addView(page.webView)
        content.addView(progress, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        view.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        page.host = this
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
        awaitedToken = page.render(url)
    }

    /** Cold path: load the document. */
    fun load(url: String) {
        progress.visibility = View.VISIBLE
        page.load(url)
    }

    private fun shown(title: String) {
        progress.visibility = View.GONE
        if (title.isNotEmpty()) toolbar.title = title
        onShown?.invoke(title)
        onShown = null
    }

    override fun onVisit(page: Page, url: Uri, replace: Boolean) = navigator.visit(this, url, replace)

    override fun onRendered(page: Page, token: Int, title: String, pageMs: Double) {
        if (token == awaitedToken) shown(title)
    }

    override fun onCommitVisible(page: Page) {
        progress.visibility = View.GONE
    }

    override fun onRouterReady(page: Page, title: String) = shown(title)

    override fun onTitle(page: Page, title: String) {
        if (title.isNotEmpty()) toolbar.title = title
    }

    fun destroy() = page.destroy()
}
