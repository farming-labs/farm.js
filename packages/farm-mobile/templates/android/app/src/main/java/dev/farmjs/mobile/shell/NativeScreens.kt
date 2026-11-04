package dev.farmjs.mobile.shell

import android.content.Context
import android.net.Uri
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * A native screen for a rule whose `screen` is `"native"` (`page.native.tsx`), `"platform"`
 * (`page.kt`), or `"server"` (drawn from the page the server renders, [FarmServerScreens]). The
 * navigator shows its view instead of a WebView.
 */
fun interface FarmNativeScreen {
    fun createView(context: Context, url: Uri): View
}

/** What a native screen may ask of the navigator. Calls are safe from any thread. */
interface FarmNativeHost {
    /** Navigate by URL, as a link in a web page would. */
    fun visit(url: Uri, replace: Boolean)

    /** Replace this screen with the route's web screen (its web twin), after a failure. */
    fun fallback(reason: String)

    fun setTitle(title: String)

    /** The screen showed its first content. */
    fun rendered()
}

/** A native screen's content: its view, an optional initial title, and how to release it. */
class FarmNativeContent(val view: View, val title: String? = null, val close: () -> Unit = {})

/**
 * The engine for `"native"` screens, such as React Native. There is one per app, created by
 * [createFarmNativeEngine]; an app without native screens has none.
 */
interface FarmNativeEngine {
    /** Start ahead of the first native screen. Called after the first screen shows content. */
    fun warm()

    /** The screen for [rule], or null when it cannot show; the navigator then shows the web twin. */
    fun open(host: FarmNativeHost, rule: RouteConfig.Rule, url: Uri): FarmNativeContent?
}

/**
 * Native screens by module id, such as `app/notes/[id]`. `"native"` rules render through
 * [engine]; native code added to an ejected project registers its own screens in [registry]
 * before the activity starts, and those win. Rules nothing can show get [MissingNativeScreen].
 */
object FarmNativeScreens {
    val registry: MutableMap<String, FarmNativeScreen> = mutableMapOf()
    var engine: FarmNativeEngine? = null

    /** Null when the engine cannot show the screen: show the route as a web screen instead. */
    fun create(rule: RouteConfig.Rule, context: Context, url: Uri, host: FarmNativeHost): FarmNativeContent? {
        val module = rule.module ?: url.path ?: "/"
        registry[module]?.let { return FarmNativeContent(it.createView(context, url)) }
        if (rule.screen == "server") return FarmServerScreens.open(context, host, url)
        val engine = engine
        if (rule.screen == "native" && engine != null) return engine.open(host, rule, url)
        return FarmNativeContent(MissingNativeScreen.create(context, rule.screen, module, url))
    }
}

/** What a native or platform rule shows while no screen is registered for its module. */
object MissingNativeScreen {
    fun create(context: Context, screen: String, module: String, url: Uri): View {
        Log.w(Navigator.TAG, "$screen screen \"$module\" for ${url.path} is not in this build")
        val padding = (24 * context.resources.displayMetrics.density).toInt()
        val message = if (screen == "platform") R.string.farm_platform_missing else R.string.farm_native_missing
        return TextView(context).apply {
            text = context.getString(message, module)
            gravity = Gravity.CENTER
            setPadding(padding, padding, padding, padding)
            setTextColor(ContextCompat.getColor(context, R.color.farm_text))
            setBackgroundColor(ContextCompat.getColor(context, R.color.farm_background))
        }
    }
}
