package dev.farmjs.mobile.shell

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONArray
import org.json.JSONObject

/**
 * Files web screens get by reference (RFC 0004, 7.5). A native module writes a large result, such
 * as a photo, into [directory] and resolves with its `file://` URI, as a React Native module does
 * for native screens. On its way to a web page the bridge swaps that URI for
 * `/__farm/files/<id>`, an unguessable path on the app's origin the page loads like any URL
 * (`<img src>`, `fetch`). This WebView answers it from the file; no bytes cross the bridge as JSON.
 *
 * One instance per WebView, so a reference works only in the page that received it. The page
 * passes it back as an argument and the module gets the `file://` URI again. When the page is
 * destroyed its references stop working and its files are deleted. Only files inside [directory]
 * are ever served, so a module that echoes a string cannot expose other app files.
 */
class FarmFiles(private val context: Context, private val config: RouteConfig) {
    /** This page's references: id to canonical file. */
    private val files = ConcurrentHashMap<String, File>()

    /** Set by [close]: an answer that arrives later gets no reference. */
    @Volatile private var closed = false

    init {
        pages.add(this)
    }

    /** A result on its way to the page: `file://` URIs inside [directory] become references. Any thread. */
    fun share(value: Any?): Any? = when (value) {
        is String -> if (closed) value else fileIn(value)?.let(this::reference) ?: value
        is JSONObject -> JSONObject().also { copy ->
            value.keys().forEach { key -> copy.put(key, share(value.opt(key))) }
        }
        is JSONArray -> JSONArray().also { copy ->
            for (index in 0 until value.length()) copy.put(share(value.opt(index)))
        }
        else -> value
    }

    /**
     * A call's arguments on their way to a module: this page's references become `file://` URIs
     * again. Throws `invalid_args` for a reference this page never received.
     */
    fun resolve(value: Any?): Any? = when (value) {
        is String -> REFERENCE.matchEntire(value.removePrefix(config.origin))?.let { match ->
            val file = files[match.groupValues[1]]
                ?: throw FarmCallException("invalid_args", "$value is not a file this screen received.")
            Uri.fromFile(file).toString()
        } ?: value
        is JSONObject -> JSONObject().also { copy ->
            value.keys().forEach { key -> copy.put(key, resolve(value.opt(key))) }
        }
        is JSONArray -> JSONArray().also { copy ->
            for (index in 0 until value.length()) copy.put(resolve(value.opt(index)))
        }
        else -> value
    }

    /** Called on a WebView background thread. Null for any request that is not a reference. */
    fun respond(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (!config.isAppUrl(url)) return null
        val match = REFERENCE.matchEntire(url.encodedPath ?: return null) ?: return null
        // A reference is answered here or not at all: it never goes to the server.
        val file = files[match.groupValues[1]]?.takeIf { it.isFile }
        if (request.method != "GET" || file == null) return notFound()
        val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase())
            ?: "application/octet-stream"
        // Deleted since the check above: answer as gone.
        val stream = runCatching { FileInputStream(file) }.getOrNull() ?: return notFound()
        return WebResourceResponse(type, null, 200, "OK", HEADERS + ("Content-Length" to file.length().toString()), stream)
    }

    /** The page closed: its references stop working, and files no other page holds are deleted. */
    fun close() {
        closed = true
        pages.remove(this)
        val held = files.values.toSet()
        files.clear()
        for (file in held) if (pages.none { it.files.containsValue(file) }) file.delete()
    }

    private fun notFound() =
        WebResourceResponse("text/plain", "utf-8", 404, "Not Found", HEADERS, ByteArrayInputStream(ByteArray(0)))

    private fun reference(file: File): String {
        files.entries.firstOrNull { it.value == file }?.let { return PREFIX + it.key }
        val bytes = ByteArray(16).also(random::nextBytes)
        val id = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        files[id] = file
        return PREFIX + id
    }

    /** The canonical file a `file://` URI names, when it is inside [directory]. */
    private fun fileIn(value: String): File? {
        if (!value.startsWith("file:")) return null
        val path = Uri.parse(value).path ?: return null
        val file = runCatching { File(path).canonicalFile }.getOrNull() ?: return null
        val root = runCatching { directory(context).canonicalPath }.getOrNull() ?: return null
        return file.takeIf { it.path.startsWith(root + File.separator) && it.isFile }
    }

    companion object {
        private const val PREFIX = "/__farm/files/"
        private val REFERENCE = Regex("^/__farm/files/([A-Za-z0-9_-]{22})$")
        private val HEADERS = mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")
        private val random = SecureRandom()

        /** Every open page's store, to keep a file another page still holds. */
        private val pages: MutableSet<FarmFiles> = ConcurrentHashMap.newKeySet()

        /**
         * Where a module writes files for web screens: `cacheDir/farm-files`. Created on first use.
         * Farm owns it: files a page received are deleted when the page closes, and the rest when
         * the app starts again.
         */
        @JvmStatic
        fun directory(context: Context): File = File(context.cacheDir, "farm-files").apply { mkdirs() }

        /** Main thread only: whether this process already cleared files from an earlier run. */
        private var cleared = false

        /** At launch, off the main thread: delete the files an earlier run of the app left. */
        fun clearStale(context: Context) {
            if (cleared) return
            cleared = true
            val startedAt = System.currentTimeMillis()
            val dir = File(context.cacheDir, "farm-files")
            Thread {
                dir.listFiles()?.forEach { if (it.lastModified() < startedAt) it.delete() }
            }.start()
        }
    }
}
