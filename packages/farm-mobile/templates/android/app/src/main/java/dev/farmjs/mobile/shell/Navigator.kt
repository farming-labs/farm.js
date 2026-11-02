package dev.farmjs.mobile.shell

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import com.google.android.material.bottomnavigation.BottomNavigationView

/**
 * The native navigator (RFC 0004, section 7.2). Every tab owns a stack of screens, every screen
 * shows one WebView (or a native view for a `"native"` or `"platform"` screen), and farm-routes.json decides
 * how a visit is presented: switch tab, push, present modally, or replace in place. Without tabs
 * the app is one stack starting at [startPath].
 */
class Navigator(
    private val context: Context,
    private val config: RouteConfig,
    private val startPath: String,
    private val tabsHost: FrameLayout,
    private val bottomNav: BottomNavigationView,
    private val modalLayer: FrameLayout,
    private val pool: WebViewPool?,
    private val newPage: () -> Page,
) {
    private val stackCount = config.tabs.size.coerceAtLeast(1)
    private val stacks = List(stackCount) { ArrayList<Screen>() }
    private val containers = List(stackCount) {
        FrameLayout(context).also { container ->
            container.setBackgroundColor(ContextCompat.getColor(context, R.color.farm_background))
            container.visibility = View.GONE
            tabsHost.addView(container, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
    }
    private val scrim = View(context).apply {
        setBackgroundColor(0x66000000)
        alpha = 0f
        isClickable = true
    }
    private var current = 0
    private var modal: Screen? = null
    private var animating = false
    private var selectingTab = false
    private val main = Handler(Looper.getMainLooper())

    /** Runs once, when the first tab's page is interactive (used to start warming the pool). */
    var onFirstReady: (() -> Unit)? = null

    private val emphasized = PathInterpolator(0.2f, 0f, 0f, 1f)
    private val width get() = tabsHost.width.toFloat().coerceAtLeast(1f)

    fun start() = selectTab(0)

    private fun rootPath(index: Int): String = config.tabs.getOrNull(index)?.path ?: startPath

    // ---- visits -------------------------------------------------------------

    fun visit(from: Screen, url: Uri, replace: Boolean) {
        if (animating) return
        if (!config.isAppUrl(url)) {
            openExternal(url)
            return
        }
        val rule = config.match(url)
        val shown = if (rule.native) "${rule.screen} ${rule.module}" else rule.presentation
        Log.i(TAG, "visit ${url.path} -> $shown (rule ${rule.route ?: "fallback"})")
        when {
            rule.presentation == "tab" && rule.tab != null && rule.tab < stackCount -> {
                if (modal != null) dismissModal(refresh = false)
                selectTab(rule.tab)
                popToRoot(rule.tab, animated = false)
            }
            rule.presentation == "modal" -> presentModal(url, rule)
            (replace || rule.presentation == "replace") && !rule.native && from.page != null -> from.render(url.toString())
            from.modal -> {
                // A push from inside a modal (for example "save, then show the note")
                // closes the modal and pushes on the tab underneath.
                dismissModal(refresh = true)
                push(url, rule)
            }
            else -> push(url, rule)
        }
    }

    /** Links to other origins open in Custom Tabs; other schemes go to the app that handles them. */
    fun openExternal(url: Uri) {
        Log.i(TAG, "external $url")
        when (url.scheme?.lowercase()) {
            "http", "https" -> try {
                CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, url)
                return
            } catch (_: ActivityNotFoundException) {
                // No browser with Custom Tabs; fall through to any app that views the URL.
            }
            // Never hand local or script URLs to another app.
            null, "file", "content", "javascript", "intent", "data", "blob" -> return
        }
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, url))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(context, "No app can open $url", Toast.LENGTH_SHORT).show()
        }
    }

    // ---- tabs ---------------------------------------------------------------

    fun selectTab(index: Int) {
        if (index != current || stacks[index].isEmpty()) {
            if (stacks[index].isEmpty()) {
                // A tab root is a screen like any other: its rule may be native or platform.
                val root = Uri.parse(config.url(rootPath(index)))
                val screen = newScreen(modal = false, rule = config.match(root), url = root)
                stacks[index] += screen
                containers[index].addView(screen.view)
                show(
                    screen,
                    config.url(rootPath(index)),
                    "tab ${rootPath(index)}",
                    onContent = { if (index == 0) onFirstReady?.let { onFirstReady = null; it() } },
                ) {}
            }
            containers.forEachIndexed { i, container -> container.visibility = if (i == index) View.VISIBLE else View.GONE }
            current = index
        }
        if (config.tabs.isNotEmpty() && bottomNav.selectedItemId != index) {
            selectingTab = true
            bottomNav.selectedItemId = index
            selectingTab = false
        }
        updateBack()
    }

    fun onTabSelected(index: Int) {
        if (!selectingTab) selectTab(index)
    }

    fun popToRoot(tab: Int, animated: Boolean) {
        val stack = stacks[tab]
        if (stack.size <= 1) return
        if (animated && tab == current) {
            // Drop everything between the root and the top, then animate the top away.
            while (stack.size > 2) stack.removeAt(1).let { containers[tab].removeView(it.view); it.destroy() }
            pop()
            return
        }
        while (stack.size > 1) stack.removeAt(stack.size - 1).let { containers[tab].removeView(it.view); it.destroy() }
        stack.last().view.apply {
            translationX = 0f
            visibility = View.VISIBLE
        }
        updateBack()
    }

    // ---- push / pop ---------------------------------------------------------

    private fun push(url: Uri, rule: RouteConfig.Rule) {
        val stack = stacks[current]
        val below = stack.last()
        val screen = newScreen(modal = false, rule = rule, url = url)
        screen.setNavigation(R.drawable.ic_back, R.string.back) { if (!animating) pop() }
        stack += screen
        containers[current].addView(screen.view)
        screen.view.translationX = width
        animating = true
        show(screen, url.toString(), "push ${url.path}") {
            screen.view.animate().translationX(0f).setDuration(PUSH_MS).setInterpolator(emphasized).withLayer().start()
            below.view.animate().translationX(-width * PARALLAX).setDuration(PUSH_MS).setInterpolator(emphasized)
                .withEndAction {
                    animating = false
                    below.view.visibility = View.INVISIBLE
                    below.view.translationX = 0f
                }.start()
        }
        updateBack()
    }

    private fun pop(fromProgress: Float = 0f) {
        val stack = stacks[current]
        if (stack.size <= 1) return
        val top = stack.removeAt(stack.size - 1)
        val below = stack.last()
        below.view.visibility = View.VISIBLE
        if (fromProgress == 0f) below.view.translationX = -width * PARALLAX
        animating = true
        val duration = (POP_MS * (1f - fromProgress * 0.5f)).toLong()
        below.view.animate().translationX(0f).setDuration(duration).setInterpolator(emphasized).start()
        top.view.animate().translationX(width).setDuration(duration).setInterpolator(emphasized).withLayer()
            .withEndAction {
                containers[current].removeView(top.view)
                top.destroy()
                animating = false
            }.start()
        updateBack()
    }

    // ---- modal --------------------------------------------------------------

    private fun presentModal(url: Uri, rule: RouteConfig.Rule) {
        if (modal != null) return
        val screen = newScreen(modal = true, rule = rule, url = url)
        screen.setNavigation(R.drawable.ic_close, R.string.close) { if (!animating) dismissModal(refresh = false) }
        modal = screen
        modalLayer.visibility = View.VISIBLE
        modalLayer.addView(scrim, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        modalLayer.addView(screen.view)
        val height = modalLayer.height.toFloat().coerceAtLeast(1f)
        screen.view.translationY = height
        animating = true
        show(screen, url.toString(), "modal ${url.path}") {
            scrim.animate().alpha(1f).setDuration(MODAL_MS).start()
            screen.view.animate().translationY(0f).setDuration(MODAL_MS).setInterpolator(emphasized).withLayer()
                .withEndAction { animating = false }.start()
        }
        updateBack()
    }

    private fun dismissModal(refresh: Boolean, fromProgress: Float = 0f) {
        val screen = modal ?: return
        modal = null
        val height = modalLayer.height.toFloat()
        val duration = (MODAL_MS * (1f - fromProgress * 0.5f)).toLong()
        scrim.animate().alpha(0f).setDuration(duration).start()
        screen.view.animate().translationY(height).scaleX(1f).scaleY(1f).setDuration(duration).setInterpolator(emphasized).withLayer()
            .withEndAction {
                modalLayer.removeView(screen.view)
                modalLayer.removeView(scrim)
                modalLayer.visibility = View.GONE
                screen.destroy()
            }.start()
        // The screen under the modal may show data the modal changed.
        if (refresh) stacks[current].lastOrNull()?.page?.bridge?.refresh()
        updateBack()
    }

    // ---- screens ------------------------------------------------------------

    private fun newScreen(modal: Boolean, rule: RouteConfig.Rule?, url: Uri?): Screen {
        if (rule != null && rule.native && url != null) {
            return Screen(context, null, FarmNativeScreens.create(rule, context, url), rule.module, modal, this)
        }
        val warm = pool?.take()
        val screen = Screen(context, warm ?: newPage(), null, null, modal, this)
        screen.view.tag = if (warm != null) "warm" else "cold"
        return screen
    }

    /**
     * Fill [screen] with [url] and call [ready] when it should animate in:
     * a warm page waits for its in-place render (capped), a cold page
     * animates right away and shows a progress bar while the document loads,
     * a native screen is ready at once.
     */
    private fun show(screen: Screen, url: String, label: String, onContent: () -> Unit = {}, ready: () -> Unit) {
        val page = screen.page
        if (page == null) {
            Log.i(TAG, "$label native=${screen.nativeModule}")
            ready()
            onContent()
            return
        }
        val started = SystemClock.uptimeMillis()
        val warm = screen.view.tag == "warm" && page.routerReady
        var fired = false
        val fire = {
            if (!fired) {
                fired = true
                ready()
            }
        }
        screen.onShown = { _ ->
            val ms = SystemClock.uptimeMillis() - started
            Log.i(TAG, "$label warm=$warm visit->content=${ms}ms (pool ready=${pool?.readyCount ?: 0})")
            fire()
            onContent()
        }
        if (warm) {
            screen.render(url)
            main.postDelayed({ fire() }, WARM_WAIT_MS)
        } else {
            screen.onPainted = {
                Log.i(TAG, "$label warm=false visit->firstPaint=${SystemClock.uptimeMillis() - started}ms")
            }
            screen.load(url)
            fire()
        }
    }

    // ---- back ---------------------------------------------------------------

    private fun canGoBack() = modal != null || stacks[current].size > 1 || current != 0

    private fun updateBack() {
        backCallback.isEnabled = canGoBack()
    }

    /** Predictive back: the top screen (or the modal) follows the gesture, then commits or settles. */
    val backCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackStarted(backEvent: BackEventCompat) {
            if (animating || modal != null) return
            val stack = stacks[current]
            if (stack.size > 1) {
                val below = stack[stack.size - 2].view
                below.visibility = View.VISIBLE
                below.translationX = -width * PARALLAX
            }
        }

        override fun handleOnBackProgressed(backEvent: BackEventCompat) {
            if (animating) return
            val progress = backEvent.progress
            modal?.let {
                val scale = 1f - 0.1f * progress
                it.view.scaleX = scale
                it.view.scaleY = scale
                it.view.translationY = modalLayer.height * 0.15f * progress
                return
            }
            val stack = stacks[current]
            if (stack.size <= 1) return
            stack.last().view.translationX = width * progress * 0.6f
            stack[stack.size - 2].view.translationX = -width * PARALLAX * (1f - progress)
        }

        override fun handleOnBackCancelled() {
            modal?.let {
                it.view.animate().translationY(0f).scaleX(1f).scaleY(1f).setDuration(150).start()
                return
            }
            val stack = stacks[current]
            if (stack.size <= 1) return
            stack.last().view.animate().translationX(0f).setDuration(150).start()
            val below = stack[stack.size - 2].view
            below.animate().translationX(-width * PARALLAX).setDuration(150)
                .withEndAction { below.visibility = View.INVISIBLE; below.translationX = 0f }.start()
        }

        override fun handleOnBackPressed() {
            if (animating) return
            val open = modal
            when {
                open != null -> dismissModal(refresh = false, fromProgress = open.view.translationY / modalLayer.height.coerceAtLeast(1))
                stacks[current].size > 1 -> pop(fromProgress = (stacks[current].last().view.translationX / width).coerceIn(0f, 1f))
                // Back from another tab's root returns to the first tab, as Material apps do.
                current != 0 -> selectTab(0)
            }
        }
    }

    companion object {
        const val TAG = "FarmShell"
        private const val PUSH_MS = 300L
        private const val POP_MS = 250L
        private const val MODAL_MS = 300L
        private const val PARALLAX = 0.25f
        private const val WARM_WAIT_MS = 250L
    }
}
