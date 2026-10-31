package dev.farmjs.mobileshell

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.ContextCompat

/** Events a WebView page reports to its current owner (a screen or the pool). */
interface PageHost {
    fun onVisit(page: Page, url: Uri, replace: Boolean)
    fun onRendered(page: Page, token: Int, title: String, pageMs: Double) {}
    fun onRenderError(page: Page, token: Int, url: String) {}
    fun onRouterReady(page: Page, title: String) {}
    fun onTitle(page: Page, title: String) {}
    fun onCommitVisible(page: Page) {}
}

/** A WebView plus its bridge. Moves from the pool into a screen without reloading. */
@SuppressLint("SetJavaScriptEnabled")
class Page(
    context: Context,
    private val config: RouteConfig,
    plugins: Map<String, FarmPlugin>,
    script: String,
    private val openExternal: (Uri) -> Unit,
) : BridgeListener {
    val webView = WebView(context)
    val bridge: FarmBridge
    var host: PageHost? = null

    /** True once the Farm client router is installed, so render() can navigate in place. */
    var routerReady = false
        private set

    /** Set while a native-initiated render is in flight; its document fallback is allowed. */
    var renderToken = 0
    private var nextToken = 0
    var loadStartedAt = 0L
        private set

    init {
        webView.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        webView.setBackgroundColor(ContextCompat.getColor(context, R.color.farm_background))
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Only the bridge's own origin rules matter; no file access.
            allowFileAccess = false
            allowContentAccess = false
        }
        bridge = FarmBridge(webView, config, plugins, script)
        bridge.listener = this
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                routerReady = false
                bridge.onPageStarted(url)
            }

            override fun onPageCommitVisible(view: WebView, url: String?) {
                host?.onCommitVisible(this@Page)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame || request.isRedirect) return false
                val url = request.url
                if (url.scheme != "http" && url.scheme != "https") {
                    openExternal(url)
                    return true
                }
                // A render the navigator asked for fell back to a document load: let it through.
                if (renderToken != 0 && config.isAppUrl(url)) return false
                // Reloads of the current document (dev HMR does location.href = location.href).
                val current = view.url?.let(Uri::parse)
                if (current != null && config.isAppUrl(url) && current.path == url.path && current.query == url.query) return false
                // Plain <a href> taps, location assignments, links to other origins.
                host?.onVisit(this@Page, url, false) ?: return false
                return true
            }
        }
    }

    fun load(url: String) {
        loadStartedAt = SystemClock.uptimeMillis()
        webView.loadUrl(url)
    }

    /** Render [url] with the running Farm router. Returns the token echoed by onRendered. */
    fun render(url: String): Int {
        val token = ++nextToken
        renderToken = token
        bridge.render(url, token)
        return token
    }

    fun destroy() {
        host = null
        bridge.listener = null
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    override fun onVisit(bridge: FarmBridge, url: Uri, replace: Boolean) {
        host?.onVisit(this, url, replace)
    }

    override fun onRendered(bridge: FarmBridge, token: Int, title: String, pageMs: Double) {
        if (token == renderToken) renderToken = 0
        host?.onRendered(this, token, title, pageMs)
    }

    override fun onRenderError(bridge: FarmBridge, token: Int, url: String, message: String) {
        host?.onRenderError(this, token, url)
        // The in-place render failed; load the document instead.
        if (token == renderToken) {
            renderToken = 0
            load(url)
        }
    }

    override fun onRouterReady(bridge: FarmBridge, title: String) {
        routerReady = true
        host?.onRouterReady(this, title)
    }

    override fun onTitle(bridge: FarmBridge, title: String) {
        host?.onTitle(this, title)
    }
}
