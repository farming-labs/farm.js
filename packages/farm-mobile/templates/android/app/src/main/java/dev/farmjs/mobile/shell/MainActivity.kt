package dev.farmjs.mobile.shell

import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import android.view.Menu
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.bottomnavigation.BottomNavigationView

/**
 * Launch options for `farm dev --mobile` builds only (adb shell am start -n <id>/dev.farmjs.mobile.shell.MainActivity ...):
 *   -e server http://10.0.2.2:3001   load a different Farm server
 *   --ei pool 0                       disable the warm pool (every push is cold)
 * Every other build ignores them: the launcher activity is exported, so any app could
 * otherwise start it with its own server and have that origin trusted by the bridge.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var navigator: Navigator

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Remote debugging needs adb access to the device, so any debuggable build may have it.
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true)

        // Launch overrides only under farm dev --mobile, never in a farm build --mobile APK.
        val dev = resources.getBoolean(R.bool.farm_dev)
        val config = RouteConfig.load(this, if (dev) intent.getStringExtra("server") else null)
        val poolSize = if (dev) intent.getIntExtra("pool", POOL_SIZE) else POOL_SIZE
        val startPath = getString(R.string.farm_start_path)
        Log.i(Navigator.TAG, "server=${config.server} pool=$poolSize rules=${config.rules.size}")

        // Device plugins reachable as native.<name>; none ship yet, so calls reject as unavailable.
        val plugins = emptyMap<String, FarmPlugin>()
        val script = assets.open("farm-bridge.js").bufferedReader().use { it.readText() }

        val root = FrameLayout(this)
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val tabsHost = FrameLayout(this)
        val poolHolder = FrameLayout(this)
        val bottomNav = BottomNavigationView(this)
        val modalLayer = FrameLayout(this).apply { visibility = View.GONE }

        tabsHost.addView(poolHolder, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        content.addView(tabsHost, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        content.addView(bottomNav, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(content, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(modalLayer, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        // Edge to edge: native bars take the system insets, pages never see them.
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val bottom = if (config.tabs.isEmpty()) maxOf(bars.bottom, ime.bottom) else 0
            content.setPadding(bars.left, bars.top, bars.right, bottom)
            modalLayer.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }

        val newPage = { Page(this, config, plugins, script, ::openExternal) }
        val warmPath = config.tabs.firstOrNull()?.path ?: startPath
        val pool = if (poolSize > 0) WebViewPool(config, poolHolder, poolSize, warmPath, newPage) else null
        navigator = Navigator(this, config, startPath, tabsHost, bottomNav, modalLayer, pool, newPage)
        navigator.onFirstReady = { pool?.start() }

        if (config.tabs.isEmpty()) {
            bottomNav.visibility = View.GONE
        } else {
            val icons = resources.obtainTypedArray(R.array.farm_tab_icons)
            config.tabs.forEachIndexed { index, tab ->
                bottomNav.menu.add(Menu.NONE, index, index, tab.title).setIcon(icons.getResourceId(index, R.drawable.ic_tab))
            }
            icons.recycle()
            bottomNav.setOnItemSelectedListener { item ->
                navigator.onTabSelected(item.itemId)
                true
            }
            bottomNav.setOnItemReselectedListener { item -> navigator.popToRoot(item.itemId, animated = true) }
        }

        onBackPressedDispatcher.addCallback(this, navigator.backCallback)
        navigator.start()
    }

    private fun openExternal(url: android.net.Uri) = navigator.openExternal(url)

    companion object {
        private const val POOL_SIZE = 2
    }
}
