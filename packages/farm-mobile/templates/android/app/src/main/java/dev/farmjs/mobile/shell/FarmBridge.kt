package dev.farmjs.mobile.shell

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject

/** A device capability reachable from JS as __farmBridge.call(name, method, args). */
interface FarmPlugin {
    val name: String

    /** Runs on the main thread. Return the resolved value or throw to reject. */
    fun call(method: String, args: JSONObject, webView: WebView): Any? =
        throw FarmCallException("unknown_method", "$name has no method \"$method\".")

    /**
     * The completion form, for plugins that answer later. Runs on the main thread; answer through
     * [result] once, from any thread, or throw to reject. [args] is the message's `args` as sent:
     * an object, or an array of positional arguments for app native modules. The default answers
     * with [call] at once.
     */
    fun callAsync(method: String, args: Any?, webView: WebView, result: FarmCallResult) {
        result.resolve(call(method, args as? JSONObject ?: JSONObject(), webView))
    }
}

/** How a plugin answers one call. The first answer wins; later ones are dropped. Any thread. */
interface FarmCallResult {
    fun resolve(value: Any?)

    fun reject(code: String, message: String)
}

/** Rejects a call with a stable code, such as `invalid_args`, instead of `native_error`. */
class FarmCallException(val code: String, message: String) : Exception(message)

/** Messages a page sends to whoever currently owns its WebView. */
interface BridgeListener {
    fun onVisit(bridge: FarmBridge, url: Uri, replace: Boolean)
    fun onRendered(bridge: FarmBridge, token: Int, title: String, pageMs: Double)
    /** [client] is the mobile client entry the document loaded, when it loaded one. */
    fun onRouterReady(bridge: FarmBridge, title: String, client: String?)
    fun onTitle(bridge: FarmBridge, title: String)
    fun onRenderError(bridge: FarmBridge, token: Int, url: String, message: String)
}

/**
 * One bridge per WebView. Pooled WebViews keep their bridge when they move
 * into a screen; only [listener] changes. Messages in arrive through an
 * origin-scoped, main-frame-only WebMessageListener; replies go out through
 * evaluateJavascript. A WebView without WebMessageListener gets no bridge at
 * all (addJavascriptInterface reaches every frame, cross-origin iframes
 * included), so the page runs as a plain web page there.
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

    /** True only in `farm dev --mobile` builds; gates per-call logging. */
    private val dev = webView.context.resources.getBoolean(R.bool.farm_dev)

    init {
        val source = script.replace("__FARM_PLUGINS__", JSONArray(plugins.keys.toList()).toString())
        val origins = setOf(config.origin)
        fallbackScript = if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            if (!warnedUnsupported) {
                warnedUnsupported = true
                Log.w(TAG, "WebMessageListener is not supported by this WebView; pages run without the native bridge")
            }
            null
        } else {
            WebViewCompat.addWebMessageListener(webView, "FarmNative", origins) {
                    _: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, _: JavaScriptReplyProxy ->
                if (isMainFrame && RouteConfig.originOf(sourceOrigin) == config.origin) {
                    message.data?.let(::handle)
                }
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(webView, source, origins)
                null
            } else {
                source
            }
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
                "visit" -> {
                    // Malformed messages are dropped, never thrown on the main thread.
                    val url = message.optString("url").ifEmpty { null } ?: return@post
                    listener?.onVisit(this, Uri.parse(url), message.optString("action") == "replace")
                }
                "rendered" -> listener?.onRendered(
                    this,
                    message.optInt("token"),
                    message.optString("title"),
                    message.optDouble("ms"),
                )
                "router-ready" -> listener?.onRouterReady(
                    this,
                    message.optString("title"),
                    // optString turns a JSON null into "null".
                    if (message.isNull("client")) null else message.optString("client").ifEmpty { null },
                )
                "title" -> listener?.onTitle(this, message.optString("title"))
                "error" -> {
                    Log.w(TAG, "render error: ${message.optString("message")}")
                    listener?.onRenderError(this, message.optInt("token"), message.optString("url"), message.optString("message"))
                }
            }
        }
    }

    private fun call(message: JSONObject) {
        // A call without a numeric id cannot be answered; drop it.
        if (message.opt("id") !is Number) return
        val id = message.optInt("id")
        val pluginName = message.optString("plugin")
        val method = message.optString("method")
        val args = message.opt("args")
        // The document that asked. A later answer goes to that document only, never to the next
        // one this WebView loads, whose call ids start again at 1.
        val doc = message.optString("doc").takeIf { DOCUMENT_ID.matches(it) }
        val started = System.nanoTime()
        val result = object : FarmCallResult {
            private val answered = AtomicBoolean(false)

            override fun resolve(value: Any?) = answer(true, value)

            override fun reject(code: String, message: String) =
                answer(false, JSONObject().put("code", code).put("message", message))

            private fun answer(ok: Boolean, value: Any?) {
                if (!answered.compareAndSet(false, true)) return
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    respond(id, doc, "$pluginName.$method", args, started, ok, value)
                } else {
                    main.post { respond(id, doc, "$pluginName.$method", args, started, ok, value) }
                }
            }
        }
        val plugin = plugins[pluginName]
        if (plugin == null) {
            result.reject("native_unavailable", "No native plugin \"$pluginName\".")
            return
        }
        try {
            plugin.callAsync(method, args, webView, result)
        } catch (error: FarmCallException) {
            result.reject(error.code, error.message ?: error.code)
        } catch (error: Exception) {
            result.reject("native_error", error.message ?: error.toString())
        }
    }

    private fun respond(id: Int, doc: String?, call: String, args: Any?, started: Long, ok: Boolean, value: Any?) {
        val ms = (System.nanoTime() - started) / 1e6
        if (dev) Log.i(TAG, "call #$id $call($args) ok=$ok -> $value (${"%.2f".format(ms)} ms native)")
        val payload = when (value) {
            null -> "null"
            is JSONObject, is JSONArray -> value.toString()
            is String -> JSONObject.quote(value)
            else -> value.toString()
        }
        val document = if (doc == null) "" else ", ${JSONObject.quote(doc)}"
        evaluate("window.__farmBridge && window.__farmBridge._resolve($id, $ok, $payload$document)")
    }

    companion object {
        const val TAG = "FarmBridge"

        /** The per-document id farm-bridge.js sends with each call. */
        private val DOCUMENT_ID = Regex("^[a-z0-9]{1,16}$")

        /** Main thread only: one warning per process, not one per pooled WebView. */
        private var warnedUnsupported = false
    }
}
