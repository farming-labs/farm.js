package dev.farmjs.mobile.shell

import androidx.appcompat.app.AppCompatActivity

/**
 * The engine for `"native"` screens. This app has no React Native screens, so it has none and
 * ships no JS engine; a build with `page.native.tsx` screens replaces this file.
 */
@Suppress("UNUSED_PARAMETER")
internal fun createFarmNativeEngine(activity: AppCompatActivity, config: RouteConfig): FarmNativeEngine? = null
