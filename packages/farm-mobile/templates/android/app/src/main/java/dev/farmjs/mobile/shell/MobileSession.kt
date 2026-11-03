package dev.farmjs.mobile.shell

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The device session native screens call the server with (RFC 0004, 7.14).
 *
 * After a web screen signs in, the WebView holds the app's session cookie. This class, in native
 * code only, trades it for a device token: it asks the server for a one-time nonce
 * (`/__farm/mobile/session/challenge`) and exchanges it with the same cookies for an access and a
 * refresh token (`/__farm/mobile/session`). Neither the nonce nor the tokens ever enter a
 * WebView. The tokens are encrypted with an AES-GCM key that lives in the Android Keystore and
 * never leaves it; only the ciphertext is in SharedPreferences. React Native screens get the
 * access token through the `FarmShell` module; the refresh token stays here.
 *
 * Signing out on a web screen makes the server revoke the device and clear its `farm_mobile`
 * marker cookie; the next sync sees the marker gone and deletes the tokens. A refresh the server
 * refuses deletes them too.
 */
class MobileSession private constructor(
    context: Context,
    private val config: RouteConfig,
) {
    data class Tokens(val access: String, val refresh: String)

    /** The `X-Farm-Mobile` header: `mobile.id`, the application id. */
    val appId: String = context.packageName
    private val basePath = context.getString(R.string.farm_base_path)
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val io = Executors.newSingleThreadExecutor { Thread(it, "farm-mobile-session") }
    private val lock = Any()
    private var loaded = false
    private var tokens: Tokens? = null

    /** The WebView cookies the last issue attempt used, so a signed-out WebView asks once. */
    private var attempted: String? = null

    private val serverUrl: String get() = config.url(basePath.ifEmpty { "/" })

    /** After a web screen loads or renders: issue after a sign-in, delete after a web sign-out. */
    fun sync() {
        io.execute {
            try {
                syncNow()
            } catch (error: Exception) {
                Log.w(TAG, "session sync failed: ${error.message}")
            }
        }
    }

    /** The current access token, or null while signed out. Any thread. */
    fun accessToken(): String? = synchronized(lock) { current()?.access }

    /**
     * A new access token after [failed] was rejected, or null when the device is signed out.
     * Serialized: a caller whose token was already replaced gets the new one without a second
     * refresh, since the server treats a reused refresh token as stolen.
     */
    fun refresh(failed: String): String? = synchronized(lock) {
        val current = current() ?: return null
        if (current.access != failed) return current.access
        val result = post("/__farm/mobile/session/refresh", JSONObject().put("refreshToken", current.refresh))
        when {
            result.code == 200 && result.body != null -> save(result.body).access
            result.code == 401 || result.code == 400 -> {
                clear()
                null
            }
            // Offline or a server error: keep the tokens and let the call fail.
            else -> null
        }
    }

    /** Revoke the device on the server, delete its tokens, and drop the server's WebView cookies. */
    fun signOut(done: () -> Unit) {
        io.execute {
            val revoked = synchronized(lock) {
                val current = current()
                clear()
                current
            }
            try {
                if (revoked != null) post("/__farm/mobile/session/revoke", JSONObject().put("refreshToken", revoked.refresh))
            } catch (error: Exception) {
                Log.w(TAG, "revoke failed: ${error.message}")
            }
            expireServerCookies()
            done()
        }
    }

    private fun syncNow() {
        val cookies = CookieManager.getInstance().getCookie(serverUrl).orEmpty()
        val hasMarker = cookies.split(';').any { it.trim().startsWith("$MARKER=") }
        synchronized(lock) {
            if (current() != null) {
                if (!hasMarker) {
                    Log.i(TAG, "signed out on the web; deleting the device token")
                    clear()
                }
                return
            }
        }
        val session = cookies.split(';').map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("$MARKER=") }
        if (session.isEmpty() || cookies == attempted) return
        attempted = cookies
        val challenge = post("/__farm/mobile/session/challenge", null, cookies)
        val nonce = challenge.body?.optString("nonce").orEmpty()
        if (challenge.code != 200 || nonce.isEmpty()) return
        val issued = post("/__farm/mobile/session", JSONObject().put("nonce", nonce), cookies)
        if (issued.code == 200 && issued.body != null) {
            synchronized(lock) { save(issued.body) }
            Log.i(TAG, "device session issued")
        }
    }

    private class Reply(val code: Int, val body: JSONObject?)

    /** A request no WebView can make: native, no Origin, with the app id. */
    private fun post(path: String, body: JSONObject?, cookies: String? = null): Reply {
        val connection = URL(config.url("$basePath$path")).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.setRequestProperty("X-Farm-Mobile", appId)
            connection.setRequestProperty("Accept", "application/json")
            if (cookies != null) connection.setRequestProperty("Cookie", cookies)
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = connection.responseCode
            // The device marker goes into the WebView cookie store, where web sign-out finds it.
            connection.headerFields.entries
                .filter { it.key.equals("Set-Cookie", ignoreCase = true) }
                .flatMap { it.value }
                .forEach { CookieManager.getInstance().setCookie(serverUrl, it) }
            CookieManager.getInstance().flush()
            val stream = if (code < 400) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            return Reply(code, runCatching { JSONObject(text) }.getOrNull())
        } finally {
            connection.disconnect()
        }
    }

    private fun current(): Tokens? {
        if (!loaded) {
            loaded = true
            tokens = prefs.getString(KEY_TOKENS, null)?.let { stored ->
                runCatching { decrypt(stored) }.getOrNull().also {
                    // A restored backup without its Keystore key, or a reset key: start over.
                    if (it == null) prefs.edit().remove(KEY_TOKENS).apply()
                }
            }
        }
        return tokens
    }

    private fun save(body: JSONObject): Tokens {
        val next = Tokens(body.getString("accessToken"), body.getString("refreshToken"))
        prefs.edit().putString(KEY_TOKENS, encrypt(next)).apply()
        tokens = next
        loaded = true
        return next
    }

    private fun clear() {
        tokens = null
        loaded = true
        attempted = null
        prefs.edit().remove(KEY_TOKENS).apply()
    }

    private fun expireServerCookies() {
        val manager = CookieManager.getInstance()
        manager.getCookie(serverUrl).orEmpty().split(';')
            .map { it.trim().substringBefore('=') }
            .filter { it.isNotEmpty() }
            .forEach { name -> manager.setCookie(serverUrl, "$name=; Max-Age=0; Path=${basePath.ifEmpty { "/" }}") }
        manager.flush()
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(tokens: Tokens): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val plain = JSONObject().put("access", tokens.access).put("refresh", tokens.refresh).toString()
        val sealed = cipher.doFinal(plain.toByteArray())
        return "${encode(cipher.iv)}.${encode(sealed)}"
    }

    private fun decrypt(stored: String): Tokens {
        val (iv, sealed) = stored.split('.', limit = 2)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, decode(iv)))
        val json = JSONObject(String(cipher.doFinal(decode(sealed))))
        return Tokens(json.getString("access"), json.getString("refresh"))
    }

    companion object {
        const val TAG = "FarmSession"
        /** The server's device marker cookie (`farm_mobile`). */
        private const val MARKER = "farm_mobile"
        private const val PREFS = "farm_mobile_session"
        private const val KEY_TOKENS = "tokens"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "farm_mobile_session"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TIMEOUT_MS = 10_000

        private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE)
        private fun decode(text: String) = Base64.decode(text, Base64.NO_WRAP or Base64.URL_SAFE)

        /** One per process; set by MainActivity, read by pages and the React Native module. */
        @Volatile
        var instance: MobileSession? = null
            private set

        fun init(context: Context, config: RouteConfig): MobileSession =
            instance ?: synchronized(this) {
                instance ?: MobileSession(context.applicationContext, config).also { instance = it }
            }
    }
}
