package dev.farmjs.examples.fieldnotes

import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import dev.farmjs.mobile.specs.NativeDeviceSpec

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
}
