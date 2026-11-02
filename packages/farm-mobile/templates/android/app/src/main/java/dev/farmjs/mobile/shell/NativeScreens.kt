package dev.farmjs.mobile.shell

import android.content.Context
import android.net.Uri
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * A native screen for a rule whose `screen` is `"native"` (`page.native.tsx`) or `"platform"`
 * (`page.kt`). The navigator shows its view instead of a WebView.
 */
fun interface FarmNativeScreen {
    fun createView(context: Context, url: Uri): View
}

/**
 * Native screens by module id, such as `app/notes/[id]`. Farm does not build `page.native.tsx`
 * or `page.kt` screens into native views yet, so a generated project registers none and every
 * native or platform rule shows [MissingNativeScreen]. Native code added to an ejected project
 * registers its screens here before the activity starts.
 */
object FarmNativeScreens {
    val registry: MutableMap<String, FarmNativeScreen> = mutableMapOf()

    fun create(rule: RouteConfig.Rule, context: Context, url: Uri): View {
        val module = rule.module ?: url.path ?: "/"
        return registry[module]?.createView(context, url) ?: MissingNativeScreen.create(context, rule.screen, module, url)
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
