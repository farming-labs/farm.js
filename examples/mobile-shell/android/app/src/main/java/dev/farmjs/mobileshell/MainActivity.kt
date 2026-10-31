package dev.farmjs.mobileshell

import android.os.Bundle
import android.util.Log
import android.view.Menu
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
 * Launch options (adb shell am start -n dev.farmjs.mobileshell/.MainActivity ...):
 *   -e server http://10.0.2.2:3001   load a different Farm server (production)
 *   --ei pool 0                       disable the warm pool (every push is cold)
 */
class MainActivity : AppCompatActivity() {
    private lateinit var navigator: Navigator

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(true)

        val config = RouteConfig.load(this, intent.getStringExtra("server"))
        val poolSize = intent.getIntExtra("pool", config.poolSize)
        Log.i(Navigator.TAG, "server=${config.server} pool=$poolSize rules=${config.rules.size}")

        val plugins = listOf<FarmPlugin>(HapticsPlugin(this))
            .filter { it.name in config.native }
            .associateBy { it.name }
        val script = assets.open("farm-bridge.js").bufferedReader().use { it.readText() }

        val root = FrameLayout(this)
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val tabsHost = FrameLayout(this)
        val poolHolder = FrameLayout(this)
        val bottomNav = BottomNavigationView(this)
        val modalLayer = FrameLayout(this).apply { visibility = android.view.View.GONE }

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
            content.setPadding(bars.left, bars.top, bars.right, 0)
            modalLayer.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }

        val newPage = { Page(this, config, plugins, script, ::openExternal) }
        val pool = if (poolSize > 0) WebViewPool(config, poolHolder, poolSize, newPage) else null
        navigator = Navigator(this, config, tabsHost, bottomNav, modalLayer, pool, newPage)
        navigator.onFirstReady = { pool?.start() }

        config.tabs.forEachIndexed { index, tab ->
            bottomNav.menu.add(Menu.NONE, index, index, tab.title).setIcon(
                when (tab.icon) {
                    "settings" -> R.drawable.ic_settings
                    else -> R.drawable.ic_notes
                },
            )
        }
        bottomNav.setOnItemSelectedListener { item ->
            navigator.onTabSelected(item.itemId)
            true
        }
        bottomNav.setOnItemReselectedListener { item -> navigator.popToRoot(item.itemId, animated = true) }

        onBackPressedDispatcher.addCallback(this, navigator.backCallback)
        navigator.start()
    }

    private fun openExternal(url: android.net.Uri) = navigator.openExternal(url)
}
