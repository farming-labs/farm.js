package dev.farmjs.mobile.shell

import android.content.res.AssetManager
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.IOException

/**
 * The mobile client's content-hashed files, bundled by farm build --mobile into assets/farm-www
 * and listed in assets/farm-assets.json (RFC 0004, 7.2).
 *
 * Documents still come from the server, which decides which client they load. A GET on the
 * server origin for exactly one of these paths is answered from the APK: a content-hashed name
 * only ever has these bytes, so the copy matches what the server would send. Any other path,
 * such as the new names of a newer deployment, goes to the network.
 */
class BundledAssets private constructor(
    private val assets: AssetManager,
    private val config: RouteConfig,
    /** URL path to content type. */
    private val types: Map<String, String>,
    val entry: String,
) {
    /** Called on a WebView background thread. Null lets the WebView load from the network. */
    fun respond(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (request.method != "GET" || !config.isAppUrl(url) || url.encodedQuery != null) return null
        val path = url.encodedPath ?: return null
        val type = types[path]
        if (type == null) {
            // A Farm client file the app does not have: a deployment newer than the app.
            if (HASHED.containsMatchIn(path)) Log.i(TAG, "assets: $path is not bundled; loading it from the server")
            return null
        }
        val stream = try {
            assets.open(ROOT + path)
        } catch (error: IOException) {
            Log.w(TAG, "assets: $path is listed but missing from the APK: ${error.message}")
            return null
        }
        if (path == entry) Log.i(TAG, "assets: mobile client $path from the app") else Log.d(TAG, "assets: $path from the app")
        val text = type.startsWith("text/") || type.endsWith("javascript") || type.endsWith("json") || type.endsWith("+xml")
        return WebResourceResponse(type, if (text) "utf-8" else null, 200, "OK", HEADERS, stream)
    }

    companion object {
        const val TAG = "FarmShell"
        private const val ROOT = "farm-www"
        private const val MANIFEST = "farm-assets.json"
        private val HASHED = Regex("-h[0-9a-f]{8,}\\.[A-Za-z0-9]+$")
        private val HEADERS = mapOf(
            "Cache-Control" to "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin" to "*",
        )

        /** The bundle farm build --mobile wrote, or null (farm dev --mobile, or no mobile client). */
        fun load(assets: AssetManager, config: RouteConfig): BundledAssets? {
            val json = try {
                assets.open(MANIFEST).bufferedReader().use { JSONObject(it.readText()) }
            } catch (error: Exception) {
                // No manifest (farm dev --mobile, or a build without a mobile client).
                return null
            }
            if (json.optInt("version") != 1) return null
            val files = json.optJSONObject("files") ?: return null
            val types = buildMap<String, String> { files.keys().forEach { put(it, files.getString(it)) } }
            Log.i(TAG, "assets: ${types.size} bundled files, mobile client ${json.optString("entry")}")
            return BundledAssets(assets, config, types, json.optString("entry"))
        }
    }
}
