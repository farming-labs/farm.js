package dev.farmjs.mobileshell

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject

/** A device capability reachable from JS as native.<name>.<method>(...). */
interface FarmPlugin {
    val name: String

    /** Runs on the main thread. Return the resolved value or throw to reject. */
    fun call(method: String, args: JSONObject, webView: WebView): Any?
}

/** Messages a page sends to whoever currently owns its WebView. */
interface BridgeListener {
    fun onVisit(bridge: FarmBridge, url: Uri, replace: Boolean)
    fun onRendered(bridge: FarmBridge, token: Int, title: String, pageMs: Double)
    fun onRouterReady(bridge: FarmBridge, title: String)
    fun onTitle(bridge: FarmBridge, title: String)
    fun onRenderError(bridge: FarmBridge, token: Int, url: String, message: String)
}

/**
 * One bridge per WebView. Pooled WebViews keep their bridge when they move
 * into a screen; only [listener] changes. Messages in arrive through an
 * origin-scoped WebMessageListener (addJavascriptInterface as a fallback);
 * replies go out through evaluateJavascript.
 */
@SuppressLint("SetJavaScriptEnabled")
class FarmBridge(
    val webView: WebView,
    private val config: RouteConfig,
    private val plugins: Map<String, FarmPlugin>,
    script: String,
) {
    var listener: BridgeListener? = null
    private val main = Handler(Looper.getMainLooper())
    private val fallbackScript: String?

    init {
        val source = script.replace("__FARM_PLUGINS__", JSONArray(plugins.keys.toList()).toString())
        val origins = setOf(config.origin)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "FarmNative", origins) {
                    _: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, _: JavaScriptReplyProxy ->
                if (isMainFrame && RouteConfig.originOf(sourceOrigin) == config.origin) {
                    message.data?.let(::handle)
                }
            }
        } else {
            webView.addJavascriptInterface(JsInterface(), "FarmNative")
        }
        fallbackScript = if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, source, origins)
            null
        } else {
            source
        }
    }

    /** Older WebViews without document-start scripts get the bridge at page start. */
    fun onPageStarted(url: String?) {
        val script = fallbackScript ?: return
        if (url != null && config.isAppUrl(Uri.parse(url))) webView.evaluateJavascript(script, null)
    }

    fun render(url: String, token: Int) {
        evaluate("window.__farmBridge && window.__farmBridge.render(${JSONObject.quote(url)}, $token)")
    }

    fun refresh() = evaluate("window.__farmBridge && window.__farmBridge.refresh()")

    private fun evaluate(js: String) {
        // Never evaluate into a page that is not the app (an error page, a redirect elsewhere).
        val current = webView.url?.let(Uri::parse)
        if (current != null && config.isAppUrl(current)) webView.evaluateJavascript(js, null)
    }

    private fun handle(raw: String) {
        main.post {
            val message = runCatching { JSONObject(raw) }.getOrNull() ?: return@post
            when (message.optString("type")) {
                "call" -> call(message)
                "visit" -> listener?.onVisit(this, Uri.parse(message.getString("url")), message.optString("action") == "replace")
                "rendered" -> listener?.onRendered(
                    this,
                    message.optInt("token"),
                    message.optString("title"),
                    message.optDouble("ms"),
                )
                "router-ready" -> listener?.onRouterReady(this, message.optString("title"))
                "title" -> listener?.onTitle(this, message.optString("title"))
                "error" -> {
                    Log.w(TAG, "render error: ${message.optString("message")}")
                    listener?.onRenderError(this, message.optInt("token"), message.optString("url"), message.optString("message"))
                }
            }
        }
    }

    private fun call(message: JSONObject) {
        val id = message.getInt("id")
        val pluginName = message.optString("plugin")
        val method = message.optString("method")
        val started = System.nanoTime()
        val plugin = plugins[pluginName]
        val (ok, value) = if (plugin == null) {
            false to JSONObject().put("code", "native_unavailable").put("message", "No native plugin \"$pluginName\".")
        } else {
            try {
                true to plugin.call(method, message.optJSONObject("args") ?: JSONObject(), webView)
            } catch (error: Exception) {
                false to JSONObject().put("code", "native_error").put("message", error.message ?: error.toString())
            }
        }
        val ms = (System.nanoTime() - started) / 1e6
        Log.i(TAG, "call #$id $pluginName.$method(${message.optJSONObject("args")}) ok=$ok -> $value (${"%.2f".format(ms)} ms native)")
        val payload = when (value) {
            null -> "null"
            is JSONObject, is JSONArray -> value.toString()
            is String -> JSONObject.quote(value)
            else -> value.toString()
        }
        evaluate("window.__farmBridge._resolve($id, $ok, $payload)")
    }

    private inner class JsInterface {
        @JavascriptInterface
        fun postMessage(raw: String) {
            // Fallback path: addJavascriptInterface is not origin-scoped, so check the page first.
            main.post {
                val current = webView.url?.let(Uri::parse)
                if (current != null && config.isAppUrl(current)) handle(raw)
            }
        }
    }

    companion object {
        const val TAG = "FarmBridge"
    }
}
