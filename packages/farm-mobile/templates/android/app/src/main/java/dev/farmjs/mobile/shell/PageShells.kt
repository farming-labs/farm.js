package dev.farmjs.mobile.shell

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import java.io.IOException

/**
 * Page shells (mobile.shells, RFC 0004 7.2), bundled by farm build --mobile into assets/farm-shells
 * and mapped to routes by farm-routes.json: a route's layouts around its loading file, with no
 * scripts. A web screen that loads a document shows its route's shell until the page paints, and
 * keeps it when the server cannot be reached. Pushes that render in a warm WebView never need one.
 *
 * The shells match the client build they were rendered with. When a document loads another
 * mobile client (a deployment newer or older than the app), the shells stop showing, and that is
 * remembered across launches until a document loads this app's client again.
 */
class PageShells private constructor(
    private val context: Context,
    private val prefs: SharedPreferences,
    private val client: String,
    private val routes: Map<String, String>,
) {
    private val cache = HashMap<String, String>()

    var enabled: Boolean = prefs.getString(KEY_MISMATCH, null) != client
        private set

    /** The shell for [rule]'s route, or null when it has none or shells are off. Main thread. */
    fun html(rule: RouteConfig.Rule): String? {
        if (!enabled) return null
        val file = rule.route?.let(routes::get) ?: return null
        cache[file]?.let { return it }
        val html = try {
            context.assets.open("$ROOT/$file").bufferedReader().use { it.readText() }
        } catch (error: IOException) {
            Log.w(TAG, "shells: $file is listed but missing from the APK: ${error.message}")
            return null
        }
        cache[file] = html
        return html
    }

    /** A document loaded the mobile client entry [loaded] (null when it loaded none). */
    fun observe(loaded: String?) {
        if (loaded == null) return
        val same = loaded.substringAfterLast('/') == client.substringAfterLast('/')
        if (same == enabled) return
        enabled = same
        prefs.edit().apply { if (same) remove(KEY_MISMATCH) else putString(KEY_MISMATCH, client) }.apply()
        Log.i(
            TAG,
            if (same) "shells: on; the server runs this app's client ($client) again"
            else "shells: off; the server runs another client build ($loaded, the shells have $client)",
        )
    }

    companion object {
        const val TAG = "FarmShell"
        private const val ROOT = "farm-shells"
        private const val PREFS = "farm-shells"
        private const val KEY_MISMATCH = "mismatched-client"

        /** The build's shells, or null (farm dev --mobile, or mobile.shells is off). */
        fun load(context: Context, config: RouteConfig): PageShells? {
            val shells = config.shells ?: return null
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return PageShells(context.applicationContext, prefs, shells.client, shells.routes).also {
                Log.i(TAG, "shells: ${shells.routes.size} routes, client ${shells.client}, enabled=${it.enabled}")
            }
        }
    }
}
