# The bridge's fallback path uses addJavascriptInterface.
-keepclassmembers class dev.farmjs.mobile.shell.FarmBridge$JsInterface {
    @android.webkit.JavascriptInterface <methods>;
}
