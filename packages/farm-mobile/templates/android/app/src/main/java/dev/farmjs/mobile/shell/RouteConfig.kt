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
        /** The `src/native/` module of a `screen: "native"` rule. */
        val module: String?,
    ) {
        val native: Boolean get() = module != null
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
        private val FALLBACK = Rule(null, Regex("^/"), "push", null, null)

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
                List(array.length()) { i ->
                    val rule = array.getJSONObject(i)
                    Rule(
                        route = rule.optString("route").ifEmpty { null },
                        pattern = Regex(rule.getString("pattern")),
                        presentation = rule.getString("presentation"),
                        tab = if (rule.has("tab")) rule.getInt("tab") else null,
                        module = if (rule.optString("screen") == "native") rule.optString("module").ifEmpty { null } else null,
                    )
                }
            }
            return RouteConfig(
                server = Uri.parse(serverOverride ?: json.getString("server")),
                tabs = tabs,
                rules = rules,
            )
        }
    }
}
