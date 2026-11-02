package dev.farmjs.mobile.shell

import android.content.Context
import android.net.Uri
import org.json.JSONObject

/** farm-routes.json, written by farm dev|build --mobile from the app's routes and `mobile`. */
class RouteConfig(
    val server: Uri,
    val tabs: List<Tab>,
    val rules: List<Rule>,
) {
    data class Tab(val path: String, val title: String, val icon: String)

    data class Rule(
        val route: String?,
        val pattern: Regex,
        val presentation: String,
        val tab: Int?,
        /** `"web"`, `"native"` (React Native, `page.native.tsx`), or `"platform"` (`page.kt`). */
        val screen: String,
        /** The screen's module id, derived from the route, such as `app/notes/[id]`. */
        val module: String?,
    ) {
        /** Shown as a native view instead of a WebView, on any rule, including tab roots. */
        val native: Boolean get() = screen != RouteConfig.WEB
    }

    /** scheme://host[:port], the only origin the bridge and link interception trust. */
    val origin: String = originOf(server)

    fun url(path: String): String = server.buildUpon().encodedPath(path).build().toString()

    fun isAppUrl(uri: Uri): Boolean = originOf(uri) == origin

    fun match(uri: Uri): Rule {
        val path = uri.path?.ifEmpty { "/" } ?: "/"
        return rules.firstOrNull { it.pattern.containsMatchIn(path) } ?: FALLBACK
    }

    companion object {
        const val WEB = "web"
        private val SCREENS = setOf(WEB, "native", "platform")
        private val FALLBACK = Rule(null, Regex("^/"), "push", null, WEB, null)

        /** The module id farm-routes.json derives for a route: `app` for `/`, else `app<route>`. */
        fun moduleOf(route: String?): String? = route?.let { if (it == "/") "app" else "app$it" }

        private fun rule(json: JSONObject): Rule {
            val route = json.optString("route").ifEmpty { null }
            // A screen tier this shell does not know is a web screen; the page always renders.
            val screen = json.optString("screen", WEB).takeIf { it in SCREENS } ?: WEB
            return Rule(
                route = route,
                pattern = Regex(json.getString("pattern")),
                presentation = json.getString("presentation"),
                tab = if (json.has("tab")) json.getInt("tab") else null,
                screen = screen,
                module = if (screen == WEB) null else json.optString("module").ifEmpty { moduleOf(route) },
            )
        }

        fun originOf(uri: Uri): String {
            val port = if (uri.port == -1) "" else ":${uri.port}"
            return "${uri.scheme}://${uri.host}$port"
        }

        fun load(context: Context, serverOverride: String?): RouteConfig {
            val json = context.assets.open("farm-routes.json").bufferedReader().use { JSONObject(it.readText()) }
            val tabs = json.getJSONArray("tabs").let { array ->
                List(array.length()) { i ->
                    val tab = array.getJSONObject(i)
                    Tab(tab.getString("path"), tab.getString("title"), tab.optString("icon"))
                }
            }
            val rules = json.getJSONArray("rules").let { array ->
                List(array.length()) { i -> rule(array.getJSONObject(i)) }
            }
            return RouteConfig(
                server = Uri.parse(serverOverride ?: json.getString("server")),
                tabs = tabs,
                rules = rules,
            )
        }
    }
}
