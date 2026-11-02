# The bridge's fallback path uses addJavascriptInterface.
-keepclassmembers class dev.farmjs.mobileshell.FarmBridge$JsInterface {
    @android.webkit.JavascriptInterface <methods>;
}
