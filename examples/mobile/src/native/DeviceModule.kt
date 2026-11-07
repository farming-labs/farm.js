package dev.farmjs.examples.fieldnotes

import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import dev.farmjs.mobile.shell.FarmFiles
import dev.farmjs.mobile.specs.NativeDeviceSpec
import java.io.File
import java.util.UUID

/** The Device module from NativeDevice.ts. Codegen generates NativeDeviceSpec from that spec. */
class DeviceModule(reactContext: ReactApplicationContext) : NativeDeviceSpec(reactContext) {
    override fun model(promise: Promise) {
        promise.resolve(Build.MODEL)
    }

    override fun vibrate(ms: Double, promise: Promise) {
        if (ms < 1) {
            promise.reject("invalid_duration", "vibrate(ms) needs 1 ms or more, got $ms.")
            return
        }
        val vibrator =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                reactApplicationContext.getSystemService(VibratorManager::class.java).defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                reactApplicationContext.getSystemService(Vibrator::class.java)
            }
        if (!vibrator.hasVibrator()) {
            promise.reject("no_vibrator", "This device has no vibrator.")
            return
        }
        vibrator.vibrate(VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
        promise.resolve(null)
    }

    /**
     * The system photo picker: no permission, and the user picks one photo. The photo is copied
     * into FarmFiles.directory, so its file:// URI loads in a native screen's Image and reaches a
     * web screen as a /__farm/files/<id> URL.
     */
    override fun pickPhoto(promise: Promise) {
        val activity = reactApplicationContext.currentActivity as? ComponentActivity
        if (activity == null) {
            promise.reject("no_activity", "pickPhoto() needs the app in the foreground.")
            return
        }
        activity.runOnUiThread {
            lateinit var launcher: ActivityResultLauncher<PickVisualMediaRequest>
            launcher = activity.activityResultRegistry.register("farm-device-photo-${UUID.randomUUID()}", PickVisualMedia()) { picked ->
                launcher.unregister()
                if (picked == null) {
                    promise.resolve(null)
                    return@register
                }
                // Copy off the main thread: a photo can be several megabytes.
                Thread {
                    try {
                        promise.resolve(Uri.fromFile(copy(picked)).toString())
                    } catch (error: Exception) {
                        promise.reject("photo_unreadable", "The picked photo could not be read: ${error.message}")
                    }
                }.start()
            }
            launcher.launch(PickVisualMediaRequest(PickVisualMedia.ImageOnly))
        }
    }

    private fun copy(picked: Uri): File {
        val resolver = reactApplicationContext.contentResolver
        val extension = resolver.getType(picked)?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) } ?: "jpg"
        val file = File(FarmFiles.directory(reactApplicationContext), "photo-${UUID.randomUUID()}.$extension")
        val input = resolver.openInputStream(picked) ?: error("no data")
        input.use { source -> file.outputStream().use { source.copyTo(it) } }
        return file
    }
}
