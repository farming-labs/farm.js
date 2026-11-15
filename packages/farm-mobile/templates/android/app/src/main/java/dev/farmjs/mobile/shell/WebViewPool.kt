package dev.farmjs.mobile.shell

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.widget.FrameLayout

/**
 * Pre-warmed WebViews. Each one loads [warmPath] and is handed out only
 * after the Farm client router is installed, so a push renders with an
 * in-page navigation instead of WebView startup plus a document load.
 *
 * Warm pages sit in [holder], behind the opaque tab containers, so Chromium
 * lays them out at screen size and keeps running their frames.
 */
class WebViewPool(
    private val config: RouteConfig,
    private val holder: FrameLayout,
    private val size: Int,
    private val warmPath: String,
    private val factory: () -> Page,
) : PageHost {
    private val warming = mutableListOf<Page>()
    private val ready = ArrayDeque<Page>()
    private val main = Handler(Looper.getMainLooper())
    private var started = false

    fun start() {
        started = true
        fill()
    }

    private fun fill() {
        if (!started) return
        while (warming.size + ready.size < size) {
            val page = factory()
            page.host = this
            holder.addView(page.webView)
            warming += page
            page.load(config.url(warmPath))
        }
    }

    /** A warm page, or null when none is ready (the caller loads a cold one). */
    fun take(): Page? {
        val page = ready.removeFirstOrNull() ?: return null
        page.host = null
        holder.removeView(page.webView)
        // Refill after the transition, so warming does not compete with it.
        main.postDelayed({ fill() }, 500)
        return page
    }

    val readyCount: Int get() = ready.size

    override fun onRouterReady(page: Page, title: String) {
        if (warming.remove(page)) {
            ready += page
            Log.i(TAG, "pool: warmed in ${SystemClock.uptimeMillis() - page.loadStartedAt} ms (ready=${ready.size})")
        }
    }

    // A warm page never navigates on its own; ignore anything it tries.
    override fun onVisit(page: Page, url: Uri, replace: Boolean) {}

    companion object {
        const val TAG = "FarmShell"
    }
}
