package dev.farmjs.mobileshell

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.webkit.WebView
import org.json.JSONObject

/** native.haptics.impact(style) */
class HapticsPlugin(private val context: Context) : FarmPlugin {
    override val name = "haptics"

    override fun call(method: String, args: JSONObject, webView: WebView): Any {
        require(method == "impact") { "haptics.$method is not a method." }
        val style = args.optString("style").ifEmpty { "light" }
        require(style in setOf("light", "medium", "heavy")) { "Unknown haptic style \"$style\"." }

        val constant = when (style) {
            "heavy" -> HapticFeedbackConstants.LONG_PRESS
            "medium" -> HapticFeedbackConstants.VIRTUAL_KEY
            else -> HapticFeedbackConstants.CLOCK_TICK
        }
        // The view path follows the user's system haptics setting.
        val performed = webView.performHapticFeedback(constant)
        val path = if (performed) "performHapticFeedback" else vibrate(style)
        return JSONObject().put("via", "native").put("style", style).put("method", path)
    }

    private fun vibrate(style: String): String {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (!vibrator.hasVibrator()) return "none"
        val effect = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            VibrationEffect.createPredefined(
                when (style) {
                    "heavy" -> VibrationEffect.EFFECT_HEAVY_CLICK
                    "medium" -> VibrationEffect.EFFECT_CLICK
                    else -> VibrationEffect.EFFECT_TICK
                },
            )
        } else {
            VibrationEffect.createOneShot(if (style == "heavy") 40 else 15, VibrationEffect.DEFAULT_AMPLITUDE)
        }
        vibrator.vibrate(effect)
        return "vibrator"
    }
}
