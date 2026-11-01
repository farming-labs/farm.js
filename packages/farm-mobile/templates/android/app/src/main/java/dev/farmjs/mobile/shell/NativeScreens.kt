package dev.farmjs.mobile.shell

import android.content.Context
import android.net.Uri
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * A native screen for a route with `native` in `mobile.routes`, such as
 * `routes: { "/feed": { native: "feed" } }`. The navigator shows its view instead of a WebView.
 */
fun interface FarmNativeScreen {
    fun createView(context: Context, url: Uri): View
}

/**
 * Native screens by module name. Farm does not build `src/native/` modules into native views
 * yet, so a generated project registers none and every native route shows [MissingNativeScreen].
 * Native code added to an ejected project registers its screens here before the activity starts.
 */
object FarmNativeScreens {
    val registry: MutableMap<String, FarmNativeScreen> = mutableMapOf()

    fun create(module: String, context: Context, url: Uri): View =
        registry[module]?.createView(context, url) ?: MissingNativeScreen.create(context, module, url)
}

/** What a native route shows while no screen is registered for its module. */
object MissingNativeScreen {
    fun create(context: Context, module: String, url: Uri): View {
        Log.w(Navigator.TAG, "native screen \"$module\" for ${url.path} is not in this build")
        val padding = (24 * context.resources.displayMetrics.density).toInt()
        return TextView(context).apply {
            text = context.getString(R.string.farm_native_missing, module)
            gravity = Gravity.CENTER
            setPadding(padding, padding, padding, padding)
            setTextColor(ContextCompat.getColor(context, R.color.farm_text))
            setBackgroundColor(ContextCompat.getColor(context, R.color.farm_background))
        }
    }
}
