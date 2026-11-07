import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import type { MobileShellContext } from "@farm.js/core/mobile";
// Core reads opted-in specs with Codegen before a shell runs; the tests do the same.
import { readFarmNativeWebSpec } from "../../../farm/src/mobile/native-specs";
import shell, {
  BUNDLED_ASSETS_DIR,
  BUNDLED_ASSETS_MANIFEST,
  createAndroidProject,
  listAndroidDevices,
  MAIN_ACTIVITY,
  NATIVE_BUNDLE_ASSET,
  PAGE_SHELLS_DIR,
  resolveTabIcon,
  SHELL_NAMESPACE,
} from "./index";

const roots: string[] = [];
const previousEnv = {
  ANDROID_HOME: process.env.ANDROID_HOME,
  ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT,
};
afterEach(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-mobile-android-"));
  roots.push(root);
  return root;
}

function context(overrides: Partial<MobileShellContext> = {}): MobileShellContext {
  return {
    root: "/app",
    os: "android",
    command: "dev",
    basePath: "",
    projectDir: "/app/.farm/output/mobile/android",
    mobile: {
      name: `Farm "Notes" & Co`,
      id: "com.example.notes",
      server: undefined,
      tabs: [
        { path: "/notes", title: "Notes", icon: "note.text" },
        { path: "/settings", title: "Settings", icon: "gear" },
      ],
      routes: { "/notes/new": { presentation: "modal" } },
      native: {
        engine: "react-native",
        auto: "report",
        routes: { "/feed": { screen: "native" } },
        islands: [],
        prefetch: "intent",
        budgets: {},
      },
    },
    // The shape createFarmMobileRouteManifest writes: `screen` on every rule, `module` derived
    // from the route on native and platform screens.
    manifest: {
      version: 1,
      server: "http://10.0.2.2:3000",
      tabs: [
        { path: "/notes", title: "Notes", icon: "note.text" },
        { path: "/settings", title: "Settings", icon: "gear" },
      ],
      prefetch: "intent",
      rules: [
        {
          route: "/notes",
          pattern: "^/notes/?$",
          presentation: "tab",
          tab: 0,
          screen: "web",
          source: "default",
        },
        {
          route: "/settings",
          pattern: "^/settings/?$",
          presentation: "tab",
          tab: 1,
          screen: "platform",
          source: "file",
          module: "app/settings",
        },
        {
          route: "/feed",
          pattern: "^/feed/?$",
          presentation: "push",
          screen: "native",
          source: "config",
          module: "app/feed",
        },
        {
          route: "/notes/new",
          pattern: "^/notes/new/?$",
          presentation: "modal",
          screen: "web",
          source: "default",
        },
        {
          route: "/notes/[id]",
          pattern: "^/notes/[^/]+/?$",
          presentation: "push",
          screen: "native",
          source: "file",
          module: "app/notes/[id]",
        },
        { pattern: "^/", presentation: "push", screen: "web" },
      ],
    },
    ...overrides,
  };
}

async function generated(ctx: MobileShellContext): Promise<Record<string, string>> {
  return Object.fromEntries(
    (await createAndroidProject(ctx)).map((file) => [
      file.path,
      typeof file.contents === "string" ? file.contents : `<${file.contents.byteLength} bytes>`,
    ]),
  );
}

describe("@farm.js/mobile/android", () => {
  it("is the Android shell", () => {
    expect(shell.os).toBe("android");
    expect(MAIN_ACTIVITY).toBe("dev.farmjs.mobile.shell.MainActivity");
  });

  it("generates the Gradle project, sorted and the same every time", async () => {
    const files = await createAndroidProject(context());
    expect(files.map((file) => file.path)).toEqual([
      "app/build.gradle.kts",
      "app/proguard-rules.pro",
      "app/src/main/AndroidManifest.xml",
      "app/src/main/assets/farm-bridge.js",
      "app/src/main/assets/farm-routes.json",
      "app/src/main/java/dev/farmjs/mobile/shell/BundledAssets.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/FarmBridge.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/FarmFiles.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/MainActivity.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/MobileSession.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/NativeEngine.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/NativeScreens.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/Navigator.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/Page.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/PageShells.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/RouteConfig.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/Screen.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/ServerScreens.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/WebViewPool.kt",
      "app/src/main/res/drawable/ic_back.xml",
      "app/src/main/res/drawable/ic_close.xml",
      "app/src/main/res/drawable/ic_home.xml",
      "app/src/main/res/drawable/ic_launcher.xml",
      "app/src/main/res/drawable/ic_notes.xml",
      "app/src/main/res/drawable/ic_person.xml",
      "app/src/main/res/drawable/ic_search.xml",
      "app/src/main/res/drawable/ic_settings.xml",
      "app/src/main/res/drawable/ic_tab.xml",
      "app/src/main/res/values-night/colors.xml",
      "app/src/main/res/values/colors.xml",
      "app/src/main/res/values/strings.xml",
      "app/src/main/res/values/tabs.xml",
      "app/src/main/res/values/themes.xml",
      "app/src/main/res/xml/network_security_config.xml",
      "build.gradle.kts",
      "gradle.properties",
      "gradle/wrapper/gradle-wrapper.jar",
      "gradle/wrapper/gradle-wrapper.properties",
      "gradlew",
      "gradlew.bat",
      "settings.gradle.kts",
    ]);
    expect(files.filter((file) => file.executable).map((file) => file.path)).toEqual(["gradlew"]);
    const jar = files.find((file) => file.path.endsWith(".jar"))!.contents;
    expect(jar).toBeInstanceOf(Uint8Array);
    // A zip archive.
    expect([...(jar as Uint8Array).subarray(0, 2)]).toEqual([0x50, 0x4b]);
    expect(await generated(context())).toEqual(await generated(context()));
  });

  it("consumes the manifest: application ID, routes, app name, and tab icons", async () => {
    const files = await generated(context());
    expect(files["app/build.gradle.kts"]).toContain('applicationId = "com.example.notes"');
    expect(files["app/build.gradle.kts"]).toContain(`namespace = "${SHELL_NAMESPACE}"`);
    expect(files["app/build.gradle.kts"]).toContain(
      'implementation("androidx.browser:browser:1.8.0")',
    );
    expect(JSON.parse(files["app/src/main/assets/farm-routes.json"])).toEqual(context().manifest);
    expect(files["app/src/main/res/values/strings.xml"]).toContain(
      '<string name="app_name">Farm \\"Notes\\" &amp; Co</string>',
    );
    expect(files["app/src/main/res/values/strings.xml"]).toContain(
      '<string name="farm_start_path" translatable="false">/</string>',
    );
    expect(files["app/src/main/res/values/tabs.xml"]).toContain(
      "<item>@drawable/ic_notes</item>\n        <item>@drawable/ic_settings</item>",
    );
    // Every Kotlin file is in the shell's own package, whatever the app ID is.
    for (const [file, source] of Object.entries(files)) {
      if (file.endsWith(".kt"))
        expect(source.startsWith(`package ${SHELL_NAMESPACE}\n`)).toBe(true);
    }
    // aapt rejects "--" inside XML comments.
    for (const [file, source] of Object.entries(files)) {
      if (!file.endsWith(".xml")) continue;
      for (const [, comment] of source.matchAll(/<!--([\s\S]*?)-->/g))
        expect(comment).not.toContain("--");
    }
  });

  it("keeps the base path as the start path and an empty icon list without tabs", async () => {
    const ctx = context({ basePath: "/docs" });
    ctx.manifest = { ...ctx.manifest, tabs: [] };
    const files = await generated(ctx);
    expect(files["app/src/main/res/values/strings.xml"]).toContain(">/docs</string>");
    expect(files["app/src/main/res/values/tabs.xml"]).toContain(
      '<array name="farm_tab_icons"></array>',
    );
  });

  it("allows cleartext only for the dev server and loopback under farm dev", async () => {
    const dev = (await generated(context()))["app/src/main/res/xml/network_security_config.xml"];
    expect(dev).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(dev).toContain('<domain includeSubdomains="false">10.0.2.2</domain>');
    expect(dev).toContain('<domain includeSubdomains="false">127.0.0.1</domain>');
    const build = (
      await generated(
        context({
          command: "build",
          manifest: { ...context().manifest, server: "https://notes.example.com" },
        }),
      )
    )["app/src/main/res/xml/network_security_config.xml"];
    expect(build).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(build).not.toContain("domain-config");
  });

  it("never exposes the bridge to every frame through addJavascriptInterface", async () => {
    const files = await generated(context());
    for (const [file, source] of Object.entries(files)) {
      if (!file.endsWith(".kt") && !file.endsWith(".pro")) continue;
      expect(source).not.toContain("addJavascriptInterface(");
      expect(source).not.toContain("@JavascriptInterface");
    }
    const bridge = files[`app/src/main/java/dev/farmjs/mobile/shell/FarmBridge.kt`];
    expect(bridge).toContain("WebViewCompat.addWebMessageListener(");
    // Malformed messages are dropped instead of throwing on the main thread.
    expect(bridge).not.toMatch(/message\.get(String|Int)\(/);
    expect(bridge).toContain('if (dev) Log.i(TAG, "call #');
  });

  it("hands web screens module files by reference, served only to the page that got them", async () => {
    const files = await generated(context());
    const shell = (name: string) => files[`app/src/main/java/dev/farmjs/mobile/shell/${name}`]!;
    const store = shell("FarmFiles.kt");
    // Only files inside cacheDir/farm-files become references, after resolving `..` and links.
    expect(store).toContain('File(context.cacheDir, "farm-files")');
    expect(store).toContain("File(path).canonicalFile");
    expect(store).toContain("it.path.startsWith(root + File.separator) && it.isFile");
    // Unguessable ids, one store per page, and a reference never goes to the server.
    expect(store).toContain("ByteArray(16).also(random::nextBytes)");
    expect(store).toContain("private val random = SecureRandom()");
    expect(store).toContain('Regex("^/__farm/files/([A-Za-z0-9_-]{22})$")');
    expect(store).toContain("if (!config.isAppUrl(url)) return null");
    expect(store).toContain('if (request.method != "GET" || file == null) return notFound()');
    expect(store).toContain('"Cache-Control" to "no-store"');
    // A page passes back only references it received.
    expect(store).toContain('"$value is not a file this screen received."');
    // Answers that arrive after the page closed get no reference.
    expect(store).toContain("is String -> if (closed) value else");

    const bridge = shell("FarmBridge.kt");
    expect(bridge).toContain("val files = FarmFiles(webView.context, config)");
    expect(bridge).toContain("plugin.callAsync(method, files.resolve(args), webView, result)");
    // Rejections pass through untouched.
    expect(bridge).toContain("val value = if (ok) files.share(answer) else answer");

    const page = shell("Page.kt");
    expect(page).toContain("bridge.files.respond(request) ?: bundle?.respond(request)");
    expect(page.indexOf("bridge.files.close()")).toBeGreaterThan(page.indexOf("fun destroy()"));
    expect(page.indexOf("bridge.files.close()")).toBeLessThan(page.indexOf("webView.destroy()"));
    expect(shell("MainActivity.kt")).toContain("FarmFiles.clearStale(this)");
    // The page shell view runs no scripts and never gets references.
    expect(page.match(/bridge\.files\.respond/g)).toHaveLength(1);
  });

  it("keeps the device session in a Keystore-encrypted store and never hands it to a WebView", async () => {
    const files = await generated(context({ basePath: "/docs" }));
    const shellFile = (name: string, from: Record<string, string>) =>
      from[`app/src/main/java/dev/farmjs/mobile/shell/${name}`]!;
    const session = shellFile("MobileSession.kt", files);
    // AES-GCM with a non-exportable Keystore key; only ciphertext reaches SharedPreferences.
    expect(session).toContain("KeyStore.getInstance(KEYSTORE)");
    expect(session).toContain('private const val KEYSTORE = "AndroidKeyStore"');
    expect(session).toContain('private const val TRANSFORMATION = "AES/GCM/NoPadding"');
    expect(session).toContain("KeyProperties.BLOCK_MODE_GCM");
    expect(session).toContain("prefs.edit().putString(KEY_TOKENS, encrypt(next))");
    expect(session).not.toMatch(/putString\(KEY_TOKENS, (?!encrypt)/);
    // Native requests with the app id; the nonce and the tokens never go through the bridge.
    expect(session).toContain('setRequestProperty("X-Farm-Mobile", appId)');
    expect(session).not.toContain("evaluateJavascript");
    expect(session).not.toContain('"Origin"');
    for (const endpoint of ["challenge", "refresh", "revoke"]) {
      expect(session).toContain(`"/__farm/mobile/session/${endpoint}"`);
    }
    expect(session).toContain('post("/__farm/mobile/session", cookies = cookies, nonce = nonce)');
    expect(session).toContain('post("/__farm/mobile/session/refresh", bearer = current.refresh)');
    // Web sign-out (the server cleared the marker) deletes the tokens.
    expect(session).toContain('private const val MARKER = "farm_mobile"');
    expect(files["app/src/main/res/values/strings.xml"]).toContain(
      '<string name="farm_base_path" translatable="false">/docs</string>',
    );
    expect(shellFile("MainActivity.kt", files)).toContain("MobileSession.init(this, config)");
    const page = shellFile("Page.kt", files);
    expect(page).toContain("override fun onPageFinished(");
    expect(page.match(/MobileSession\.instance\?\.sync\(\)/g)).toHaveLength(2);
    for (const [file, source] of Object.entries(files)) {
      if (file.endsWith(".kt") && !file.endsWith("MobileSession.kt")) {
        expect(source, file).not.toContain("accessToken()");
      }
    }
  });

  it("sets farm_dev only under farm dev, and reads launch overrides only when it is set", async () => {
    const strings = (command: "dev" | "build") =>
      generated(context({ command })).then((files) => files["app/src/main/res/values/strings.xml"]);
    expect(await strings("dev")).toContain('<bool name="farm_dev">true</bool>');
    expect(await strings("build")).toContain('<bool name="farm_dev">false</bool>');

    const activity = (await generated(context()))[
      "app/src/main/java/dev/farmjs/mobile/shell/MainActivity.kt"
    ];
    expect(activity).toContain("val dev = resources.getBoolean(R.bool.farm_dev)");
    const overrides = activity
      .split("\n")
      .filter((line) => /intent\.get\w+Extra\(/.test(line) && !line.includes('"farmOpen"'));
    expect(overrides).toHaveLength(2);
    for (const line of overrides) expect(line).toMatch(/if \(dev\) intent\.get\w+Extra\(/);
    // A debuggable `farm build --mobile --apk` must not take a server from another app's intent.
    expect(activity).not.toMatch(/if \(debuggable\) intent\./);
    // farmOpen (CI's launch path) only visits a path on the app's own server, as a tapped link
    // would, and a release build ignores it.
    expect(activity).toContain(
      'val open = intent.takeIf { debuggable }?.getStringExtra("farmOpen")',
    );
    expect(activity).toContain(
      `?.takeIf { it.startsWith("/") && !it.startsWith("//") && '\\\\' !in it }`,
    );
  });

  it("reads screen on every rule, tab roots included, with module ids from the route", async () => {
    const files = await generated(context());
    const shellFile = (name: string) => files[`app/src/main/java/dev/farmjs/mobile/shell/${name}`];
    const routes = shellFile("RouteConfig.kt");
    // Every tier the manifest writes, and web for a rule without one or with an unknown one.
    expect(routes).toContain('private val SCREENS = setOf(WEB, "native", "platform", "server")');
    expect(routes).toContain('json.optString("screen", WEB).takeIf { it in SCREENS } ?: WEB');
    // A rule is native by its screen, not by the old `screen: "native"` plus module string.
    expect(routes).toContain("val native: Boolean get() = screen != RouteConfig.WEB");
    expect(routes).not.toContain('optString("screen") == "native"');
    expect(routes).toContain(
      'fun moduleOf(route: String?): String? = route?.let { if (it == "/") "app" else "app$it" }',
    );
    // Tab roots look up their own rule instead of always opening a WebView.
    const navigator = shellFile("Navigator.kt");
    expect(navigator).toContain("newScreen(modal = false, rule = config.match(root), url = root)");
    expect(navigator).not.toContain("rule = null");
    expect(navigator).toContain("if (rule != null && rule.native && url != null)");
    // Platform screens get their own placeholder until page.kt screens load.
    expect(shellFile("NativeScreens.kt")).toContain(
      'if (screen == "platform") R.string.farm_platform_missing else R.string.farm_native_missing',
    );
    const strings = files["app/src/main/res/values/strings.xml"];
    expect(strings).toContain('name="farm_native_missing"');
    expect(strings).toContain('name="farm_platform_missing"');
    expect(strings).not.toContain("src/native");
  });

  it("maps tab icons to the built-in drawables", () => {
    expect(resolveTabIcon("ic_notes")).toBe("ic_notes");
    expect(resolveTabIcon("gear")).toBe("ic_settings");
    expect(resolveTabIcon("house")).toBe("ic_home");
    expect(resolveTabIcon("Search")).toBe("ic_search");
    expect(resolveTabIcon("rocket")).toBe("ic_tab");
  });
});

// The Gradle files a shell without native screens generated before React Native screens existed.
const WEB_ONLY_ROOT_GRADLE = `plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
`;

const WEB_ONLY_APP_GRADLE = `// Generated by @farm.js/mobile/android on every farm dev|build --mobile. Do not edit.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.farmjs.mobile.shell"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.example.notes"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")
}
`;

const ENGINE = "app/src/main/java/dev/farmjs/mobile/shell/NativeEngine.kt";
const WEB_MODULES = "app/src/main/java/dev/farmjs/mobile/shell/FarmWebModules.kt";

describe("bundled client assets", () => {
  async function clientOutput(): Promise<string> {
    const dir = await tempDir();
    const files: Record<string, string | Uint8Array> = {
      "farm-mobile-client-h1a2b3c4d.js": 'import "./chunks/react-h5e6f7a8b.js";',
      "chunks/react-h5e6f7a8b.js": "export {};",
      "assets/farm-client-h0badcafe.css": "main{color:red}",
      "assets/inter-h12345678.woff2": new Uint8Array([0x77, 0x4f, 0x46, 0x32]),
      // In the client output but not listed: never bundled.
      "farm-client-h99999999.js": "web client",
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await writeFile(path.join(dir, file), contents);
    }
    return dir;
  }

  const assets = (dir: string) => ({
    dir,
    entry: "/farm-mobile-client-h1a2b3c4d.js",
    files: [
      "/assets/farm-client-h0badcafe.css",
      "/assets/inter-h12345678.woff2",
      "/chunks/react-h5e6f7a8b.js",
      "/farm-mobile-client-h1a2b3c4d.js",
    ],
  });

  it("copies the mobile client into the APK with each file's content type", async () => {
    const dir = await clientOutput();
    const files = await createAndroidProject(context({ command: "build", assets: assets(dir) }));
    const byPath = Object.fromEntries(files.map((file) => [file.path, file.contents]));
    expect(
      Object.keys(byPath)
        .filter((file) => file.startsWith(`${BUNDLED_ASSETS_DIR}/`))
        .sort(),
    ).toEqual([
      `${BUNDLED_ASSETS_DIR}/assets/farm-client-h0badcafe.css`,
      `${BUNDLED_ASSETS_DIR}/assets/inter-h12345678.woff2`,
      `${BUNDLED_ASSETS_DIR}/chunks/react-h5e6f7a8b.js`,
      `${BUNDLED_ASSETS_DIR}/farm-mobile-client-h1a2b3c4d.js`,
    ]);
    expect(
      Buffer.from(byPath[`${BUNDLED_ASSETS_DIR}/assets/inter-h12345678.woff2`] as Uint8Array),
    ).toEqual(Buffer.from([0x77, 0x4f, 0x46, 0x32]));
    expect(JSON.parse(String(byPath[BUNDLED_ASSETS_MANIFEST]))).toEqual({
      version: 1,
      entry: "/farm-mobile-client-h1a2b3c4d.js",
      files: {
        "/assets/farm-client-h0badcafe.css": "text/css",
        "/assets/inter-h12345678.woff2": "font/woff2",
        "/chunks/react-h5e6f7a8b.js": "text/javascript",
        "/farm-mobile-client-h1a2b3c4d.js": "text/javascript",
      },
    });
  });

  it("bundles nothing under farm dev, and refuses paths outside the client output", async () => {
    const files = await generated(context());
    expect(files[BUNDLED_ASSETS_MANIFEST]).toBeUndefined();
    expect(Object.keys(files).some((file) => file.startsWith(`${BUNDLED_ASSETS_DIR}/`))).toBe(
      false,
    );
    const dir = await clientOutput();
    for (const file of ["/../secret.js", "/chunks//x.js", "relative.js", "/a\\b.js"]) {
      await expect(
        createAndroidProject(
          context({ command: "build", assets: { ...assets(dir), files: [file] } }),
        ),
      ).rejects.toThrow(/Refusing to bundle/);
    }
  });

  it("answers only listed GETs on the server origin from the APK, and loads documents with the shell header", async () => {
    const files = await generated(context());
    const bundled = files["app/src/main/java/dev/farmjs/mobile/shell/BundledAssets.kt"];
    expect(bundled).toContain(
      'if (request.method != "GET" || !config.isAppUrl(url) || url.encodedQuery != null) return null',
    );
    expect(bundled).toContain("val type = types[path]");
    expect(bundled).toContain('"Cache-Control" to "public, max-age=31536000, immutable"');
    // A newer deployment's names fall through to the network, and say so.
    expect(bundled).toContain("is not bundled; loading it from the server");
    const page = files["app/src/main/java/dev/farmjs/mobile/shell/Page.kt"];
    expect(page).toContain("bundle?.respond(request)");
    expect(page).toContain('val SHELL_HEADERS = mapOf("X-Farm-Shell" to "android")');
    expect(page).toContain("webView.loadUrl(url, SHELL_HEADERS)");
    // Every document load goes through load(), so it carries the header.
    for (const [file, source] of Object.entries(files)) {
      if (!file.endsWith(".kt")) continue;
      expect(source.match(/\.loadUrl\(/g)?.length ?? 0, file).toBe(
        file.endsWith("/Page.kt") ? 1 : 0,
      );
    }
    expect(files["app/src/main/java/dev/farmjs/mobile/shell/MainActivity.kt"]).toContain(
      "val bundle = BundledAssets.load(assets, config)",
    );
  });
});

describe("page shells", () => {
  const html = "<!DOCTYPE html><html data-farm-page-shell><body><p>Loading notes</p></body></html>";
  const shells = {
    client: "/farm-mobile-client-h1a2b3c4d.js",
    routes: { "/notes": "0123456789abcdef.html", "/notes/new": "0123456789abcdef.html" },
    files: { "0123456789abcdef.html": html },
  };
  const withShells = () => {
    const base = context({ command: "build" });
    return context({
      command: "build",
      shells,
      manifest: { ...base.manifest, shells: { client: shells.client, routes: shells.routes } },
    });
  };

  it("bundles one file per shell and maps routes to them in farm-routes.json", async () => {
    const files = await generated(withShells());
    expect(Object.keys(files).filter((file) => file.startsWith(`${PAGE_SHELLS_DIR}/`))).toEqual([
      `${PAGE_SHELLS_DIR}/0123456789abcdef.html`,
    ]);
    expect(files[`${PAGE_SHELLS_DIR}/0123456789abcdef.html`]).toBe(html);
    expect(JSON.parse(files["app/src/main/assets/farm-routes.json"]).shells).toEqual({
      client: "/farm-mobile-client-h1a2b3c4d.js",
      routes: { "/notes": "0123456789abcdef.html", "/notes/new": "0123456789abcdef.html" },
    });
    const routes = files["app/src/main/java/dev/farmjs/mobile/shell/RouteConfig.kt"];
    expect(routes).toContain('json.optJSONObject("shells")');
    expect(files["app/src/main/java/dev/farmjs/mobile/shell/PageShells.kt"]).toContain(
      'private const val ROOT = "farm-shells"',
    );
  });

  it("bundles none without shells, and refuses a file name core would not write", async () => {
    const files = await generated(context({ command: "build" }));
    expect(Object.keys(files).some((file) => file.startsWith(`${PAGE_SHELLS_DIR}/`))).toBe(false);
    for (const name of ["../x.html", "notes.html", "0123456789abcdef.js"]) {
      await expect(
        createAndroidProject(context({ shells: { ...shells, files: { [name]: html } } })),
      ).rejects.toThrow(/Refusing to write the page shell/);
    }
  });

  it("shows a shell only over a cold document load, until the page paints or for good offline", async () => {
    const files = await generated(context());
    const navigator = files["app/src/main/java/dev/farmjs/mobile/shell/Navigator.kt"];
    const warm = navigator.slice(
      navigator.indexOf("if (warm) {"),
      navigator.indexOf("} else {", navigator.indexOf("if (warm) {")),
    );
    expect(warm).toContain("screen.render(url)");
    expect(warm).not.toContain("shell");
    expect(navigator).toContain("screen.load(url, shell)");
    // The web twin of a native screen that fails is a cold load too.
    expect(navigator).toContain(
      "it.showWeb(newPage(), url.toString(), shells?.html(config.match(url)))",
    );
    const screen = files["app/src/main/java/dev/farmjs/mobile/shell/Screen.kt"];
    expect(screen).toContain("if (!loadFailed) removeShell()");
    expect(screen).toContain("override fun onLoadError(page: Page)");
    const page = files["app/src/main/java/dev/farmjs/mobile/shell/Page.kt"];
    const view = page.slice(page.indexOf("fun createShellView"), page.indexOf("/** Render [url]"));
    // A shell runs no code, never navigates, and loads its stylesheet from the APK.
    expect(view).toContain("settings.javaScriptEnabled = false");
    expect(view).toContain(
      "shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true",
    );
    expect(view).toContain("bundle?.respond(request)");
    expect(view).toContain('loadDataWithBaseURL(url, html, "text/html", "utf-8", null)');
    expect(page).toContain("error.errorCode in UNREACHABLE");
    expect(files["app/src/main/java/dev/farmjs/mobile/shell/MainActivity.kt"]).toContain(
      "val shells = PageShells.load(this, config)",
    );
  });

  it("stops showing shells while documents load another client build", async () => {
    const files = await generated(context());
    const shellsKt = files["app/src/main/java/dev/farmjs/mobile/shell/PageShells.kt"];
    expect(shellsKt).toContain("if (!enabled) return null");
    expect(shellsKt).toContain("loaded.substringAfterLast('/') == client.substringAfterLast('/')");
    expect(shellsKt).toContain("putString(KEY_MISMATCH, client)");
    expect(files["app/src/main/java/dev/farmjs/mobile/shell/Page.kt"]).toContain(
      "shells?.observe(client)",
    );
  });
});

describe("React Native screens", () => {
  const native = (overrides: Partial<NonNullable<MobileShellContext["native"]>> = {}) => ({
    engine: "react-native" as const,
    reactNativeVersion: "0.88.1",
    hermesVersion: "260318099.0.5",
    modules: ["app/feed", "app/notes/[id]"],
    ...overrides,
  });

  it("adds nothing of React Native to an app without native screens", async () => {
    const files = await generated(context());
    expect(files["build.gradle.kts"]).toBe(WEB_ONLY_ROOT_GRADLE);
    expect(files["app/build.gradle.kts"]).toBe(WEB_ONLY_APP_GRADLE);
    expect(files["app/src/main/res/values/farm_native.xml"]).toBeUndefined();
    expect(files[NATIVE_BUNDLE_ASSET]).toBeUndefined();
    expect(files[ENGINE]).toContain("FarmNativeEngine? = null");
    expect(Object.keys(files).filter((file) => file.includes("/jni/"))).toEqual([]);
    for (const [file, source] of Object.entries(files)) {
      expect(source, file).not.toMatch(/com\.facebook|hermes|react-native|ReactNative/i);
    }
  });

  it("adds React Native, its engine, and the screens' bytecode for a build", async () => {
    const dir = await tempDir();
    const bundle = path.join(dir, "index.android.hbc");
    await writeFile(bundle, new Uint8Array([0xc6, 0x1f, 0xbc, 0x03, 1, 2, 3]));
    const ctx = context({ command: "build", native: native({ bundle }) });
    const files = await createAndroidProject(ctx);
    const byPath = Object.fromEntries(files.map((file) => [file.path, file.contents]));
    expect(byPath["build.gradle.kts"]).toContain(
      'id("org.jetbrains.kotlin.android") version "2.2.21"',
    );
    const app = String(byPath["app/build.gradle.kts"]);
    expect(app).toContain('implementation("com.facebook.react:react-android:0.88.1")');
    expect(app).toContain('implementation("com.facebook.hermes:hermes-android:260318099.0.5")');
    expect(app).toContain('abiFilters += listOf("arm64-v8a", "x86_64")');
    // libappmodules.so connects React Native's core Java TurboModules to JSI.
    expect(app).toContain('ndkVersion = "27.1.12297006"');
    expect(app).toContain("prefab = true");
    expect(app).toContain('path = file("src/main/jni/CMakeLists.txt")');
    expect(app).toContain('arguments += listOf("-DANDROID_STL=c++_shared")');
    expect(String(byPath["app/src/main/jni/CMakeLists.txt"])).toContain(
      "target_link_libraries(appmodules ReactAndroid::reactnative ReactAndroid::jsi fbjni::fbjni)",
    );
    expect(String(byPath["app/src/main/jni/OnLoad.cpp"])).toContain(
      "DefaultTurboModuleManagerDelegate::javaModuleProvider =",
    );
    // Everything else matches the web-only project.
    const webOnly = app
      .replace(
        /\n\n {8}ndk \{[\s\S]*?\n {8}\}\n\n {8}externalNativeBuild \{[\s\S]*?\n {8}\}(?=\n {4}\})/,
        "",
      )
      .replace(/\n\n {4}ndkVersion[\s\S]*?\n {4}packaging \{[\s\S]*?\n {4}\}(?=\n\})/, "")
      .replace(/\n {4}\/\/ React Native screens[^\n]*(\n {4}implementation[^\n]*){2}/, "");
    expect(webOnly).toBe(WEB_ONLY_APP_GRADLE);
    expect([...(byPath[NATIVE_BUNDLE_ASSET] as Uint8Array)]).toEqual([
      0xc6, 0x1f, 0xbc, 0x03, 1, 2, 3,
    ]);
    const engine = String(byPath[ENGINE]);
    expect(engine).toContain("ReactNativeEngine(activity, config)");
    expect(engine).toContain("DefaultNewArchitectureEntryPoint.load()");
    expect(engine).toContain('const val BUNDLE_ASSET = "farm-native.hbc"');
    expect(NATIVE_BUNDLE_ASSET.endsWith("/farm-native.hbc")).toBe(true);
    // The web-only stub is replaced, not duplicated.
    expect(files.filter((file) => file.path === ENGINE)).toHaveLength(1);
    expect(byPath["app/src/main/res/values/farm_native.xml"]).toContain(
      '<integer name="react_native_dev_server_port">8081</integer>',
    );
    const paths = files.map((file) => file.path);
    expect(paths).toEqual(paths.toSorted((left, right) => (left < right ? -1 : 1)));
  });

  it("ships the images the screens import as the resources React Native looks them up by", async () => {
    const dir = await tempDir();
    const bundle = path.join(dir, "android.hbc");
    await writeFile(bundle, new Uint8Array([0xc6, 0x1f, 0xbc, 0x03]));
    // Metro's Android layout: drawable-<density>/<path as a resource name>.png.
    const assetsDir = path.join(dir, "android-assets");
    for (const density of ["xhdpi", "xxhdpi"]) {
      await mkdir(path.join(assetsDir, `drawable-${density}`), { recursive: true });
      await writeFile(
        path.join(assetsDir, `drawable-${density}`, "src_app_map_blaze.png"),
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      );
    }
    const files = await createAndroidProject(
      context({ command: "build", native: native({ bundle, assetsDir }) }),
    );
    const byPath = Object.fromEntries(files.map((file) => [file.path, file.contents]));
    for (const density of ["xhdpi", "xxhdpi"]) {
      expect([
        ...(byPath[`app/src/main/res/drawable-${density}/src_app_map_blaze.png`] as Uint8Array),
      ]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
    // Without images, nothing is added.
    const plain = await createAndroidProject(
      context({ command: "build", native: native({ bundle }) }),
    );
    expect(plain.some((file) => file.path.includes("drawable-xhdpi/"))).toBe(false);

    // An asset never replaces one of the shell's own resources.
    await mkdir(path.join(assetsDir, "values"), { recursive: true });
    await writeFile(path.join(assetsDir, "values", "strings.xml"), "<resources/>");
    await expect(
      createAndroidProject(context({ command: "build", native: native({ bundle, assetsDir }) })),
    ).rejects.toThrow(/would replace the shell's app\/src\/main\/res\/values\/strings\.xml/);
  });

  it("points the debug app at Metro under farm dev, with no bundled bytecode", async () => {
    const files = await generated(
      context({
        native: native({
          devServer: { port: 8082, mainModule: ".farm/output/mobile/native/index" },
        }),
      }),
    );
    expect(files[NATIVE_BUNDLE_ASSET]).toBeUndefined();
    const resources = files["app/src/main/res/values/farm_native.xml"];
    expect(resources).toContain(
      '<string name="farm_native_main_module" translatable="false">.farm/output/mobile/native/index</string>',
    );
    expect(resources).toContain('<integer name="react_native_dev_server_port">8082</integer>');
    // Metro is reached only from a farm dev build.
    expect(files[ENGINE]).toContain("useDevSupport = dev");
    expect(files[ENGINE]).toContain(
      "private val dev = activity.resources.getBoolean(R.bool.farm_dev)",
    );
  });

  it("gives React Native screens the access token and refresh, never the refresh token", async () => {
    const files = await generated(context({ native: native() }));
    const engine = files[ENGINE]!;
    for (const method of [
      "fun session(promise: Promise)",
      "fun refreshSession(failedToken: String, promise: Promise)",
      "fun signOut(promise: Promise)",
    ]) {
      expect(engine).toContain(method);
    }
    expect(engine).toContain('putString("accessToken", session.accessToken())');
    expect(engine).not.toMatch(/refreshToken|\.refresh\b(?!\()/);
  });

  it("signs native screens in only under auth.basePath on mobile.server, with no cookie or redirect", async () => {
    const files = await generated(context({ native: native(), authBasePath: "/api/auth" }));
    expect(files["app/src/main/res/values/strings.xml"]).toContain(
      '<string name="farm_auth_base_path" translatable="false">/api/auth</string>',
    );
    const withoutAuth = await generated(context({ native: native() }));
    expect(withoutAuth["app/src/main/res/values/strings.xml"]).toContain(
      '<string name="farm_auth_base_path" translatable="false"></string>',
    );

    const session = files["app/src/main/java/dev/farmjs/mobile/shell/MobileSession.kt"]!;
    const signIn = session.slice(
      session.indexOf("    fun signIn("),
      session.indexOf("    private fun syncNow()"),
    );
    // The path is checked before anything is sent, and the URL is always mobile.server's.
    expect(signIn).toContain("if (!isAuthRoute(path, authBasePath)) {");
    expect(signIn).toContain('URL(config.url("$basePath$path"))');
    expect(signIn).toContain('connection.requestMethod = "POST"');
    expect(signIn).toContain("connection.instanceFollowRedirects = false");
    expect(signIn).not.toMatch(/"Cookie"|"Origin"|X-Farm-Mobile/);
    // A refused sign-in or a redirect keeps no cookie and issues nothing; a success issues the
    // device token through the same challenge and exchange a web sign-in uses.
    const refused = signIn.indexOf(
      "if (code !in 200..299 || cookies.isEmpty()) return reply to null",
    );
    expect(refused).toBeGreaterThan(0);
    expect(signIn.indexOf("manager.setCookie(serverUrl, it)")).toBeGreaterThan(refused);
    expect(signIn.indexOf("issue(jar)")).toBeGreaterThan(refused);
    expect(session).toContain("        issue(cookies)\n    }");
    expect(session.match(/post\("\/__farm\/mobile\/session\/challenge"/g)).toHaveLength(1);

    // isAuthRoute, as the Kotlin runs it: a literal prefix, then safe path segments only.
    expect(session).toContain(
      'authBasePath.startsWith("/") &&\n                path.startsWith("$authBasePath/") &&\n                AUTH_ROUTE.matches(path.substring(authBasePath.length))',
    );
    const pattern = /private val AUTH_ROUTE = Regex\("([^"]+)"\)/.exec(session)![1]!;
    const isAuthRoute = (path: string, base: string) =>
      base.startsWith("/") &&
      path.startsWith(`${base}/`) &&
      new RegExp(`^(?:${pattern})$`).test(path.slice(base.length));
    for (const path of ["/api/auth/sign-in/email", "/api/auth/sign-up/email"]) {
      expect(isAuthRoute(path, "/api/auth"), path).toBe(true);
    }
    for (const path of [
      "/api/auth",
      "/api/auth/",
      "/api/authx/sign-in/email",
      "/api/notes",
      "/api/auth/../notes",
      "/api/auth/%2e%2e/notes",
      "/api/auth/sign-in/email?callbackURL=https://evil.example",
      "/api/auth/sign-in/email#x",
      "/api/auth//evil.example/sign-in",
      "//evil.example/api/auth/sign-in/email",
      "https://evil.example/api/auth/sign-in/email",
      "/api/auth/sign-in/email\n",
    ]) {
      expect(isAuthRoute(path, "/api/auth"), path).toBe(false);
    }
    // An app without auth has no native sign-in at all.
    expect(isAuthRoute("/api/auth/sign-in/email", "")).toBe(false);
  });

  it("reaches native sign-in only from React Native JS, never from a WebView page", async () => {
    for (const ctx of [
      context({ authBasePath: "/api/auth" }),
      context({ native: native(), authBasePath: "/api/auth" }),
    ]) {
      const files = await generated(ctx);
      const kotlin = Object.entries(files).filter(([file]) => file.endsWith(".kt"));
      // The only caller is the React Native module, and only when the app has native screens.
      const callers = kotlin
        .filter(([, source]) => /\.signIn\(/.test(source))
        .map(([file]) => file);
      expect(callers).toEqual(ctx.native ? [ENGINE] : []);
      // WebView pages reach native code only through FarmBridge, whose plugin map is empty and
      // which never touches the device session.
      const bridge = files["app/src/main/java/dev/farmjs/mobile/shell/FarmBridge.kt"]!;
      expect(bridge).not.toMatch(/MobileSession|signIn|session/i);
      expect(files["app/src/main/java/dev/farmjs/mobile/shell/MainActivity.kt"]).toContain(
        "val plugins = emptyMap<String, FarmPlugin>()",
      );
      for (const [file, source] of kotlin) {
        expect(source, file).not.toMatch(/:\s*FarmPlugin\b/);
      }
      expect(files["app/src/main/assets/farm-bridge.js"]).not.toMatch(/signIn|session/i);
      // Page.kt only asks the session to sync after a load, as before.
      const page = files["app/src/main/java/dev/farmjs/mobile/shell/Page.kt"]!;
      expect(page.match(/MobileSession\.instance\?\.\w+/g)).toEqual([
        "MobileSession.instance?.sync",
        "MobileSession.instance?.sync",
      ]);
    }
    const engine = (await generated(context({ native: native() })))[ENGINE]!;
    const method = engine.slice(
      engine.indexOf("    fun signIn(path: String, body: String, promise: Promise)"),
    );
    expect(engine).toContain(
      "@ReactMethod\n    fun signIn(path: String, body: String, promise: Promise)",
    );
    // JS gets the status and the body; never a cookie or a token.
    expect(method.slice(0, method.indexOf("    companion object"))).not.toMatch(
      /[Cc]ookie|[Tt]oken/,
    );
    expect(method).toContain('putInt("status", reply.status)');
    expect(method).toContain('putString("body", reply.body)');
  });

  it("shows the web twin when a native screen cannot open or fails", async () => {
    const files = await generated(context({ native: native() }));
    const shellFile = (name: string) => files[`app/src/main/java/dev/farmjs/mobile/shell/${name}`];
    const navigator = shellFile("Navigator.kt");
    // A null screen from the engine opens the route as a web screen.
    expect(navigator).toContain("if (content != null) {");
    expect(navigator).toContain("as a web screen");
    expect(navigator).toContain(
      "it.showWeb(newPage(), url.toString(), shells?.html(config.match(url)))",
    );
    expect(shellFile("Screen.kt")).toContain(
      "fun showWeb(page: Page, url: String, shell: String? = null)",
    );
    // The shell keeps its screens through a theme change and repaints its chrome.
    expect(shellFile("MainActivity.kt")).toContain(
      "override fun onConfigurationChanged(newConfig: Configuration)",
    );
    expect(shellFile("MainActivity.kt")).toContain("navigator.applyTheme()");
    expect(shellFile("Navigator.kt")).toContain(
      "stacks.forEach { stack -> stack.forEach(Screen::applyTheme) }",
    );
    // "server" rules draw the page the server renders, and fall back to the web screen.
    expect(shellFile("RouteConfig.kt")).toContain('setOf(WEB, "native", "platform", "server")');
    expect(shellFile("NativeScreens.kt")).toContain(
      'if (rule.screen == "server") return FarmServerScreens.open(context, host, url)',
    );
    expect(shellFile("ServerScreens.kt")).toContain(
      'const val CONTENT_TYPE = "application/vnd.farm.native+json"',
    );
    // The shared runtime starts after the first screen shows content, with the WebView pool.
    expect(shellFile("MainActivity.kt")).toContain("engine?.warm()");
    const engine = files[ENGINE];
    expect(engine).toContain("exceptionHandler = { error -> fail(error) }");
    expect(engine).toContain("screens.values.toList().forEach { it.fallback(reason) }");
    expect(engine).toContain("if (failure != null && !dev) return null");
    // A Fast Refresh full reload tears the instance down too; it must not drop to the web twin.
    expect(engine).not.toContain("addBeforeDestroyListener");
    // React Native's libraries load off the main thread while the first screen draws.
    expect(engine).toContain('name = "farm-react-native-load"');
  });
});

describe("the bridge script", () => {
  async function loadBridge(client: string | null = null) {
    const files = await generated(context());
    const source = files["app/src/main/assets/farm-bridge.js"].replace("__FARM_PLUGINS__", "[]");
    const posted: Array<Record<string, unknown>> = [];
    const window: Record<string, any> = {
      FarmNative: { postMessage: (message: string) => posted.push(JSON.parse(message)) },
    };
    const sandbox = {
      window,
      location: { href: "http://10.0.2.2:3000/notes", pathname: "/notes", search: "" },
      document: {
        title: "Notes",
        addEventListener() {},
        // The mobile client entry a shell document loads.
        querySelector: (selector: string) =>
          client !== null && selector.includes("farm-mobile-client-")
            ? { getAttribute: (name: string) => (name === "src" ? client : null) }
            : null,
        documentElement: {
          attributes: {} as Record<string, string>,
          setAttribute(name: string, value: string) {
            this.attributes[name] = value;
          },
        },
      },
      performance: { now: () => 0 },
      requestAnimationFrame: (callback: () => void) => callback(),
      URL,
      Promise,
      Map,
      JSON,
      String,
      Object,
      Error,
    };
    vm.runInNewContext(source, sandbox);
    return { bridge: window.__farmBridge, window, posted, root: sandbox.document.documentElement };
  }

  it("reports the mobile client a document loaded, for page shells", async () => {
    const { window, posted } = await loadBridge("/farm-mobile-client-h1a2b3c4d.js");
    window.__FARM_SPA_ROUTER__ = { navigate: async () => {} };
    expect(posted).toContainEqual(
      expect.objectContaining({ type: "router-ready", client: "/farm-mobile-client-h1a2b3c4d.js" }),
    );
  });

  it("settles a call when native answers later, only in the document that asked", async () => {
    const { bridge, posted } = await loadBridge();
    const vibrate = bridge.call("Device", "vibrate", [200]);
    const message = posted.at(-1)!;
    expect(message).toMatchObject({
      type: "call",
      id: 1,
      plugin: "Device",
      method: "vibrate",
      args: [200],
    });
    expect(message.doc).toMatch(/^[a-z0-9]{1,16}$/);
    // Call ids restart in every document: an answer for another document's call 1 is dropped.
    bridge._resolve(1, true, "stale", "zzzzzzzzzz");
    bridge._resolve(1, true, null, message.doc);
    await expect(vibrate).resolves.toBeNull();

    const invalid = bridge.call("Device", "vibrate", ["200"]);
    bridge._resolve(
      2,
      false,
      { code: "invalid_args", message: "ms must be a number." },
      message.doc,
    );
    await expect(invalid).rejects.toMatchObject({
      code: "invalid_args",
      message: "ms must be a number.",
    });
    // A shell that answers without the document id (iOS) still settles its calls.
    const model = bridge.call("Device", "model");
    expect(posted.at(-1)).toMatchObject({ id: 3, args: {} });
    bridge._resolve(3, true, "Pixel 8");
    await expect(model).resolves.toBe("Pixel 8");
  });

  it("answers plugins that complete later through the same call message", async () => {
    const files = await generated(context());
    const bridge = files["app/src/main/java/dev/farmjs/mobile/shell/FarmBridge.kt"]!;
    // Synchronous plugins keep working: the completion form defaults to call().
    expect(bridge).toContain(
      "    fun callAsync(method: String, args: Any?, webView: WebView, result: FarmCallResult) {\n" +
        "        result.resolve(call(method, args as? JSONObject ?: JSONObject(), webView))\n",
    );
    // One answer per call, from any thread, delivered on the main thread to the asking document.
    expect(bridge).toContain("if (!answered.compareAndSet(false, true)) return");
    expect(bridge).toContain("main.post { respond(id, doc,");
    expect(bridge).toContain(
      'evaluate("window.__farmBridge && window.__farmBridge._resolve($id, $ok, $payload$document)")',
    );
    expect(bridge).toContain(
      "} catch (error: FarmCallException) {\n            result.reject(error.code,",
    );
    // Unregistered modules still answer native_unavailable.
    expect(bridge).toContain('result.reject("native_unavailable", "No native plugin');
  });

  it("marks the page as running in the shell so app CSS can hide web-only chrome", async () => {
    const { root } = await loadBridge();
    expect(root.attributes["data-farm-shell"]).toBe("android");
  });

  it("takes in-app navigations as visits, except the ones it renders itself", async () => {
    const { bridge, window, posted } = await loadBridge();
    const navigations: string[] = [];
    let delegate: ((context: unknown) => boolean) | undefined;
    // What a --mobile client's delegate does with the bridge.
    delegate = (context) => bridge.offerNavigation(context) === true;
    window.__FARM_SPA_ROUTER__ = {
      prefetch: () => {
        throw new Error("prefetched");
      },
      async navigate(href: string, options: { replace?: boolean }) {
        if (delegate!({ url: href, action: options.replace ? "replace" : "push" })) return;
        navigations.push(href);
      },
    };
    expect(posted).toContainEqual({
      type: "router-ready",
      url: "http://10.0.2.2:3000/notes",
      title: "Notes",
      client: null,
    });
    // Prefetch is a no-op in the shell.
    await window.__FARM_SPA_ROUTER__.prefetch("/notes/2");

    expect(delegate({ url: "http://10.0.2.2:3000/notes/1", action: "push" })).toBe(true);
    expect(delegate({ url: "http://10.0.2.2:3000/settings", action: "replace" })).toBe(true);
    expect(posted.filter((message) => message.type === "visit")).toEqual([
      { type: "visit", url: "http://10.0.2.2:3000/notes/1", action: "advance" },
      { type: "visit", url: "http://10.0.2.2:3000/settings", action: "replace" },
    ]);

    // A render the navigator asked for on a pooled page navigates in place.
    bridge.render("http://10.0.2.2:3000/notes/7", 3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigations).toEqual(["http://10.0.2.2:3000/notes/7"]);
    expect(posted.at(-1)).toMatchObject({ type: "rendered", token: 3 });
    // And taps afterwards are visits again.
    expect(delegate({ url: "http://10.0.2.2:3000/notes/8", action: "push" })).toBe(true);
  });
});

describe("devices", () => {
  async function fakeSdk(devices: string): Promise<string> {
    const sdk = await tempDir();
    await mkdir(path.join(sdk, "platform-tools"), { recursive: true });
    const adb = path.join(sdk, "platform-tools", "adb");
    await writeFile(adb, `#!/bin/sh\ncat <<'EOF'\n${devices}\nEOF\n`);
    await chmod(adb, 0o755);
    return sdk;
  }

  it.skipIf(process.platform === "win32")("lists ready devices from adb", async () => {
    const sdk = await fakeSdk(
      "List of devices attached\nemulator-5554\tdevice\nR58M\tunauthorized\n0A1B\tdevice\n\n",
    );
    expect(await listAndroidDevices(path.join(sdk, "platform-tools", "adb"))).toEqual([
      "emulator-5554",
      "0A1B",
    ]);
    expect(await listAndroidDevices(path.join(sdk, "missing-adb"))).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "explains how to run the app when nothing is connected, without building",
    async () => {
      process.env.ANDROID_HOME = await fakeSdk("List of devices attached\n\n");
      const root = await tempDir();
      const result = await shell.run(
        context({ root, projectDir: path.join(root, ".farm", "output", "mobile", "android") }),
      );
      expect(result.launched).toBe(false);
      expect(result.message).toContain("No Android device or emulator is connected.");
      expect(result.message).toContain("cd .farm/output/mobile/android && ./gradlew installDebug");
      expect(result.message).toContain(`adb shell am start -n com.example.notes/${MAIN_ACTIVITY}`);
      await expect(
        readFile(path.join(root, ".farm", "output", "mobile", "android", "local.properties")),
      ).rejects.toThrow();
    },
  );
});

describe("React Native native modules (autolinking)", () => {
  const native = (overrides: Partial<NonNullable<MobileShellContext["native"]>> = {}) => ({
    engine: "react-native" as const,
    reactNativeVersion: "0.88.1",
    hermesVersion: "260318099.0.5",
    modules: ["app/feed", "app/notes/[id]"],
    ...overrides,
  });

  async function writePackage(
    dir: string,
    pkg: Record<string, unknown>,
    files: Record<string, string> = {},
  ): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "package.json"), JSON.stringify(pkg));
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await writeFile(path.join(dir, file), contents);
    }
  }

  const androidModule = (className: string, javaPackage: string) => ({
    "android/build.gradle": 'apply plugin: "com.android.library"\n',
    [`android/src/main/java/${javaPackage.replace(/\./g, "/")}/${className}.java`]: `package ${javaPackage};\n\npublic class ${className} extends BaseReactPackage {\n}\n`,
  });

  /** An app with React Native installed and the given dependencies. */
  async function app(pkg: Record<string, unknown>): Promise<string> {
    const root = await tempDir();
    const modules = path.join(root, "node_modules");
    await writePackage(root, { name: "app", ...pkg });
    await writePackage(path.join(modules, "react-native"), {
      name: "react-native",
      version: "0.88.1",
    });
    await writePackage(path.join(modules, "@react-native/gradle-plugin"), {
      name: "@react-native/gradle-plugin",
    });
    await writePackage(path.join(modules, "@react-native/codegen"), {
      name: "@react-native/codegen",
    });
    await writePackage(path.join(modules, "zod"), { name: "zod", version: "4.0.0" });
    await writePackage(path.join(modules, "react"), { name: "react", version: "19.2.8" });
    await writePackage(
      path.join(modules, "@react-native-community/netinfo"),
      {
        name: "@react-native-community/netinfo",
        version: "12.0.1",
        codegenConfig: { name: "RNCNetInfoSpec", type: "modules", jsSrcsDir: "src/internal" },
      },
      androidModule("NetInfoPackage", "com.reactnativecommunity.netinfo"),
    );
    await writePackage(
      path.join(modules, "react-native-dev-only"),
      { name: "react-native-dev-only", codegenConfig: { name: "DevOnlySpec", type: "modules" } },
      androidModule("DevOnlyPackage", "com.example.devonly"),
    );
    // Installed, but only as a dependency of a dependency.
    await writePackage(
      path.join(modules, "react-native-transitive"),
      {
        name: "react-native-transitive",
        codegenConfig: { name: "TransitiveSpec", type: "modules" },
      },
      androidModule("TransitivePackage", "com.example.transitive"),
    );
    await writePackage(
      path.join(modules, "react-native-device-info"),
      { name: "react-native-device-info", version: "15.0.2" },
      androidModule("RNDeviceInfo", "com.learnium.RNDeviceInfo"),
    );
    return root;
  }

  /**
   * Every file linking native modules can change. Their snapshots under __snapshots__/unlinked are
   * the output from before modules were linked, so apps that link none keep it unchanged.
   */
  const LINKABLE = [
    "settings.gradle.kts",
    "build.gradle.kts",
    "gradle.properties",
    "gradle/wrapper/gradle-wrapper.properties",
    "app/build.gradle.kts",
    "app/src/main/jni/CMakeLists.txt",
    "app/src/main/jni/OnLoad.cpp",
    ENGINE,
    "app/src/main/res/values/farm_native.xml",
    // Web screens' module calls replace its empty plugin map, only when a module opts in.
    "app/src/main/java/dev/farmjs/mobile/shell/MainActivity.kt",
  ];

  async function expectUnlinked(ctx: MobileShellContext, name: string): Promise<void> {
    const files = await createAndroidProject(ctx);
    const list = files.map((file) => `${file.path}${file.executable ? " (executable)" : ""}\n`);
    await expect(list.join("")).toMatchFileSnapshot(`__snapshots__/unlinked/${name}/files.txt`);
    const contents = Object.fromEntries(files.map((file) => [file.path, String(file.contents)]));
    for (const file of LINKABLE.filter((file) => file in contents)) {
      await expect(contents[file]).toMatchFileSnapshot(`__snapshots__/unlinked/${name}/${file}`);
    }
  }

  it("leaves web-only projects unchanged, even with native modules installed", async () => {
    const root = await app({
      dependencies: { "@react-native-community/netinfo": "12.0.1", zod: "4.0.0" },
      devDependencies: { "react-native": "0.88.1" },
    });
    await expectUnlinked(context(), "web-only");
    await expectUnlinked(context({ root }), "web-only");
  });

  it("leaves native-screen projects without native modules unchanged", async () => {
    const root = await app({
      dependencies: { react: "19.2.8", zod: "4.0.0" },
      devDependencies: { "react-native": "0.88.1", "react-native-dev-only": "1.0.0" },
    });
    await expectUnlinked(context({ native: native() }), "native");
    await expectUnlinked(context({ root, native: native() }), "native");
  });

  it("links the app's own dependencies with Android code through React Native's Gradle plugin", async () => {
    const root = await app({
      dependencies: { "@react-native-community/netinfo": "12.0.1", zod: "4.0.0" },
      devDependencies: { "react-native": "0.88.1", "react-native-dev-only": "1.0.0" },
    });
    const real = (dir: string) => realpathSync(dir).split(path.sep).join("/");
    const modules = path.join(root, "node_modules");
    const netinfo = real(path.join(modules, "@react-native-community/netinfo"));
    const files = await generated(
      context({
        root,
        native: native({
          devServer: { port: 8082, mainModule: ".farm/output/mobile/native/index" },
        }),
      }),
    );

    const settings = files["settings.gradle.kts"]!;
    expect(settings).toContain(
      `includeBuild(${JSON.stringify(real(path.join(modules, "@react-native/gradle-plugin")))})`,
    );
    expect(settings).toContain('id("com.facebook.react.settings")');
    expect(settings).toContain('autolinkLibrariesFromConfigFile(file("autolinking.json"))');
    // Modules such as netinfo declare their own repositories.
    expect(settings).toContain("RepositoriesMode.PREFER_SETTINGS");
    expect(settings).not.toContain("FAIL_ON_PROJECT_REPOS");

    const autolinking = JSON.parse(files["autolinking.json"]!);
    expect(autolinking.reactNativeVersion).toBe("0.88.1");
    expect(autolinking.project.android.packageName).toBe(SHELL_NAMESPACE);
    expect(autolinking.project.android.applicationId).toBe("com.example.notes");
    expect(Object.keys(autolinking.dependencies)).toEqual(["@react-native-community/netinfo"]);
    expect(autolinking.dependencies["@react-native-community/netinfo"]).toEqual({
      root: netinfo,
      name: "@react-native-community/netinfo",
      platforms: {
        android: {
          sourceDir: `${netinfo}/android`,
          packageImportPath: "import com.reactnativecommunity.netinfo.NetInfoPackage;",
          packageInstance: "new NetInfoPackage()",
          buildTypes: [],
          libraryName: "RNCNetInfoSpec",
          componentDescriptors: [],
          cmakeListsPath: `${netinfo}/android/build/generated/source/codegen/jni/CMakeLists.txt`,
          cxxModuleCMakeListsModuleName: null,
          cxxModuleCMakeListsPath: null,
          cxxModuleHeaderName: null,
          dependencyConfiguration: null,
          isPureCxxDependency: false,
        },
      },
    });

    expect(files["build.gradle.kts"]).toContain('apply(plugin = "com.facebook.react.rootproject")');
    // Modules build against the app's SDK levels (rootProject.ext), not their own defaults.
    for (const line of [
      'extra["compileSdkVersion"] = 35',
      'extra["minSdkVersion"] = 26',
      'extra["targetSdkVersion"] = 35',
      'extra["buildToolsVersion"] = "36.0.0"',
      'extra["ndkVersion"] = "27.1.12297006"',
      'extra["kotlinVersion"] = "2.2.21"',
    ]) {
      expect(files["build.gradle.kts"]).toContain(line);
    }
    expect(files["build.gradle.kts"]).toContain(
      'classpath("com.android.tools.build:gradle:9.2.1")',
    );
    const appGradle = files["app/build.gradle.kts"]!;
    expect(appGradle).toContain('id("com.facebook.react")');
    expect(appGradle).toContain("autolinkLibrariesWithApp()");
    expect(appGradle).toContain(`root = file(${JSON.stringify(real(root))})`);
    expect(appGradle).toContain('implementation("com.facebook.react:react-android:0.88.1")');
    expect(appGradle).toContain('path = file("src/main/jni/CMakeLists.txt")');

    expect(files["gradle/wrapper/gradle-wrapper.properties"]).toContain("gradle-9.4.1-bin.zip");
    const properties = files["gradle.properties"]!;
    expect(properties).toContain("android.builtInKotlin=false");
    expect(properties).toContain("android.newDsl=false");
    // The plugin writes the Metro port resource itself, so farm_native.xml no longer does.
    expect(properties).toContain("reactNativeDevServerPort=8082");
    expect(files["app/src/main/res/values/farm_native.xml"]).not.toContain(
      "react_native_dev_server_port",
    );

    expect(files["app/src/main/jni/CMakeLists.txt"]).toContain(
      "include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)",
    );
    const onLoad = files["app/src/main/jni/OnLoad.cpp"]!;
    expect(onLoad).toContain("#include <autolinking.h>");
    expect(onLoad).toContain("autolinking_ModuleProvider(name, params)");
    expect(onLoad).toContain("autolinking_cxxModuleProvider(name, jsInvoker)");
    expect(onLoad).toContain("autolinking_registerProviders(registry)");
    // React Native's Gradle plugin generates PackageList in com.facebook.react, not the app's
    // package, and the engine does not import it.
    expect(files[ENGINE]).toContain(
      "packageList = com.facebook.react.PackageList(activity.application).packages + FarmShellPackage()",
    );

    // Dev dependencies and dependencies of dependencies are never linked.
    for (const source of Object.values(files)) {
      expect(source).not.toMatch(
        /react-native-dev-only|react-native-transitive|DevOnlySpec|TransitiveSpec/,
      );
    }
  });

  it("links the real @react-native-community/netinfo package from the mobile example", async () => {
    const example = fileURLToPath(new URL("../../../../examples/mobile/", import.meta.url));
    const files = await generated(context({ root: example, native: native() }));
    const linked = JSON.parse(files["autolinking.json"]!).dependencies;
    expect(Object.keys(linked)).toEqual(["@react-native-community/netinfo"]);
    expect(linked["@react-native-community/netinfo"].platforms.android).toMatchObject({
      packageImportPath: "import com.reactnativecommunity.netinfo.NetInfoPackage;",
      packageInstance: "new NetInfoPackage()",
      libraryName: "RNCNetInfoSpec",
    });
  });

  it("refuses a module without new architecture support, naming the package", async () => {
    const root = await app({
      dependencies: {
        "@react-native-community/netinfo": "12.0.1",
        "react-native-device-info": "15.0.2",
      },
    });
    await expect(createAndroidProject(context({ root, native: native() }))).rejects.toThrow(
      /"react-native-device-info" has Android code but no "codegenConfig"/,
    );
    await expect(createAndroidProject(context({ root, native: native() }))).rejects.toMatchObject({
      name: "FarmMobileError",
    });
  });

  const DEVICE_SPEC = `import { TurboModuleRegistry, type TurboModule } from "react-native";

export interface Spec extends TurboModule {
  model(): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>("Device");
`;
  const DEVICE_MODULE = `package com.example.notes.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import dev.farmjs.mobile.specs.NativeDeviceSpec

class DeviceModule(reactContext: ReactApplicationContext) : NativeDeviceSpec(reactContext) {
    override fun model(promise: Promise) = promise.resolve(android.os.Build.MODEL)
}
`;

  /** `src/native/` with the given files, as core's scan reports it. */
  async function appModules(
    root: string,
    files: Record<string, string>,
  ): Promise<NonNullable<MobileShellContext["appModules"]>> {
    const dir = path.join(root, "src/native");
    await mkdir(dir, { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(path.join(dir, name), contents);
    }
    const names = Object.keys(files).sort();
    return {
      dir,
      specs: names
        .filter((name) => name.startsWith("Native"))
        .map((name) => ({
          name: /getEnforcing<Spec>\("(\w+)"\)/.exec(files[name]!)![1]!,
          file: path.join(dir, name),
        })),
      android: names.filter((name) => name.endsWith(".kt")).map((name) => path.join(dir, name)),
      ios: names.filter((name) => name.endsWith(".swift")).map((name) => path.join(dir, name)),
    };
  }

  it("links the app's own modules from src/native as a local library, with Codegen configured", async () => {
    // No community module: the app's own module alone switches to the plugin toolchain.
    const root = await app({ dependencies: { react: "19.2.8", zod: "4.0.0" } });
    const modules = await appModules(root, {
      "NativeDevice.ts": DEVICE_SPEC,
      "DeviceModule.kt": DEVICE_MODULE,
      "DeviceModule.swift": "import Foundation\n",
    });
    const projectDir = "/app/.farm/output/mobile/android";
    const files = await generated(context({ root, native: native(), appModules: modules }));

    const library = `${projectDir}/farm-app-modules`;
    const autolinking = JSON.parse(files["autolinking.json"]!);
    expect(Object.keys(autolinking.dependencies)).toEqual(["farm-app-modules"]);
    expect(autolinking.dependencies["farm-app-modules"]).toEqual({
      root: library,
      name: "farm-app-modules",
      platforms: {
        android: {
          sourceDir: `${library}/android`,
          packageImportPath: "import dev.farmjs.mobile.modules.FarmAppModulesPackage;",
          packageInstance: "new FarmAppModulesPackage()",
          buildTypes: [],
          libraryName: "FarmAppSpec",
          componentDescriptors: [],
          cmakeListsPath: `${library}/android/build/generated/source/codegen/jni/CMakeLists.txt`,
          cxxModuleCMakeListsModuleName: null,
          cxxModuleCMakeListsPath: null,
          cxxModuleHeaderName: null,
          dependencyConfiguration: null,
          isPureCxxDependency: false,
        },
      },
    });

    // Codegen: the plugin reads ../package.json of a library and generates its specs from
    // jsSrcsDir, in the Java package the Kotlin class imports its base class from.
    expect(JSON.parse(files["farm-app-modules/package.json"]!).codegenConfig).toEqual({
      name: "FarmAppSpec",
      type: "modules",
      jsSrcsDir: "specs",
      android: { javaPackageName: "dev.farmjs.mobile.specs" },
    });
    expect(files["farm-app-modules/specs/NativeDevice.ts"]).toBe(DEVICE_SPEC);
    const gradle = files["farm-app-modules/android/build.gradle.kts"]!;
    expect(gradle).toContain('id("com.android.library")');
    expect(gradle).toContain('id("com.facebook.react")');
    expect(gradle).toContain('implementation("com.facebook.react:react-android:0.88.1")');
    const libraryManifest = files["farm-app-modules/android/src/main/AndroidManifest.xml"]!;
    expect(libraryManifest).toContain("<manifest />");
    // The manifest merger rejects "--" inside XML comments.
    for (const [, comment] of libraryManifest.matchAll(/<!--([\s\S]*?)-->/g))
      expect(comment).not.toContain("--");
    expect(
      files["farm-app-modules/android/src/main/java/com/example/notes/modules/DeviceModule.kt"],
    ).toBe(DEVICE_MODULE);
    const pkg =
      files[
        "farm-app-modules/android/src/main/java/dev/farmjs/mobile/modules/FarmAppModulesPackage.kt"
      ]!;
    expect(pkg).toContain("class FarmAppModulesPackage : BaseReactPackage()");
    expect(pkg).toContain('"Device" -> com.example.notes.modules.DeviceModule(reactContext)');
    expect(pkg).toContain(
      '"Device" to ReactModuleInfo("Device", "com.example.notes.modules.DeviceModule", false, false, false, true),',
    );
    // Swift is for iOS only.
    expect(Object.keys(files).filter((file) => file.endsWith(".swift"))).toEqual([]);

    // The same toolchain and app setup as a community module.
    expect(files["settings.gradle.kts"]).toContain(
      'autolinkLibrariesFromConfigFile(file("autolinking.json"))',
    );
    expect(files["build.gradle.kts"]).toContain('apply(plugin = "com.facebook.react.rootproject")');
    expect(files["app/build.gradle.kts"]).toContain("autolinkLibrariesWithApp()");
    expect(files["app/src/main/jni/OnLoad.cpp"]).toContain(
      "autolinking_ModuleProvider(name, params)",
    );
    expect(files[ENGINE]).toContain(
      "com.facebook.react.PackageList(activity.application).packages",
    );
    expect(files["gradle/wrapper/gradle-wrapper.properties"]).toContain("gradle-9.4.1-bin.zip");
  });

  it("links the app's modules after the community modules", async () => {
    const root = await app({ dependencies: { "@react-native-community/netinfo": "12.0.1" } });
    const modules = await appModules(root, {
      "NativeDevice.ts": DEVICE_SPEC,
      "DeviceModule.kt": DEVICE_MODULE,
    });
    const files = await generated(context({ root, native: native(), appModules: modules }));
    expect(Object.keys(JSON.parse(files["autolinking.json"]!).dependencies)).toEqual([
      "@react-native-community/netinfo",
      "farm-app-modules",
    ]);
  });

  it("leaves projects without native screens unchanged, even with app modules", async () => {
    const root = await app({ dependencies: { react: "19.2.8" } });
    const modules = await appModules(root, {
      "NativeDevice.ts": DEVICE_SPEC,
      "DeviceModule.kt": DEVICE_MODULE,
    });
    await expectUnlinked(context({ root, appModules: modules }), "web-only");
    // Kotlin or Swift without a spec registers nothing.
    const loose = await appModules(await app({ dependencies: {} }), {
      "Helpers.kt": "package com.example.notes\n",
    });
    await expectUnlinked(context({ native: native(), appModules: loose }), "native");
  });

  it("names the spec and the class to add when an app module has no Kotlin class", async () => {
    const root = await app({ dependencies: {} });
    const missing = await appModules(root, { "NativeDevice.ts": DEVICE_SPEC });
    await expect(
      createAndroidProject(context({ root, native: native(), appModules: missing })),
    ).rejects.toThrow(
      'src/native/NativeDevice.ts registers the native module "Device", but no Kotlin class in src/native extends NativeDeviceSpec. Add one, such as src/native/DeviceModule.kt with "class DeviceModule(reactContext: ReactApplicationContext) : NativeDeviceSpec(reactContext)" and "import dev.farmjs.mobile.specs.NativeDeviceSpec".',
    );

    const other = await app({ dependencies: {} });
    const twice = await appModules(other, {
      "NativeDevice.ts": DEVICE_SPEC,
      "DeviceModule.kt": DEVICE_MODULE,
      "PhoneModule.kt": DEVICE_MODULE.replace("class DeviceModule", "class PhoneModule"),
    });
    await expect(
      createAndroidProject(context({ root: other, native: native(), appModules: twice })),
    ).rejects.toThrow(
      "com.example.notes.modules.DeviceModule and com.example.notes.modules.PhoneModule both extend NativeDeviceSpec.",
    );

    const third = await app({ dependencies: {} });
    const unpackaged = await appModules(third, {
      "NativeDevice.ts": DEVICE_SPEC,
      "DeviceModule.kt": DEVICE_MODULE.replace("package com.example.notes.modules\n", ""),
    });
    await expect(
      createAndroidProject(context({ root: third, native: native(), appModules: unpackaged })),
    ).rejects.toThrow(/src\/native\/DeviceModule\.kt has no package declaration/);

    // The library cannot compile against the shell: fail here, with the fix, not in Gradle.
    const fourth = await app({ dependencies: {} });
    const shellImport = await appModules(fourth, {
      "NativeDevice.ts": DEVICE_SPEC,
      "DeviceModule.kt": DEVICE_MODULE.replace(
        "import com.facebook.react.bridge.Promise\n",
        "import com.facebook.react.bridge.Promise\nimport dev.farmjs.mobile.shell.FarmFiles\n",
      ),
    });
    await expect(
      createAndroidProject(context({ root: fourth, native: native(), appModules: shellImport })),
    ).rejects.toThrow(
      "src/native/DeviceModule.kt imports dev.farmjs.mobile.shell.FarmFiles, a class of Farm's Android shell. App modules build as their own Gradle module (farm-app-modules), which cannot see the shell. Remove the import: write files for web screens into File(context.cacheDir, \"farm-files\") by name, and use React Native's APIs for the rest.",
    );
  });

  it("links the mobile example's Device module, and Codegen generates the class it extends", async () => {
    const example = fileURLToPath(new URL("../../../../examples/mobile/", import.meta.url));
    const dir = path.join(example, "src/native");
    const modules = {
      dir,
      specs: [{ name: "Device", file: path.join(dir, "NativeDevice.ts") }],
      android: [path.join(dir, "DeviceModule.kt")],
      ios: [],
    };
    const projectDir = await tempDir();
    const project = await createAndroidProject(
      context({ root: example, projectDir, native: native(), appModules: modules }),
    );
    for (const file of project) {
      await mkdir(path.dirname(path.join(projectDir, file.path)), { recursive: true });
      await writeFile(path.join(projectDir, file.path), file.contents);
    }
    const linked = JSON.parse(await readFile(path.join(projectDir, "autolinking.json"), "utf8"));
    expect(Object.keys(linked.dependencies)).toEqual([
      "@react-native-community/netinfo",
      "farm-app-modules",
    ]);

    // React Native's own Codegen, run the way its Gradle plugin runs it for a library.
    const reactNative = realpathSync(path.join(example, "node_modules/react-native"));
    const codegen = realpathSync(path.join(reactNative, "../@react-native/codegen"));
    const library = path.join(projectDir, "farm-app-modules");
    const schema = path.join(library, "android/build/generated/source/codegen/schema.json");
    const out = path.join(library, "android/build/generated/source/codegen");
    await mkdir(out, { recursive: true });
    const run = (args: string[]) =>
      execFileSync(process.execPath, args, { cwd: library, encoding: "utf8" });
    run([
      path.join(codegen, "lib/cli/combine/combine-js-to-schema-cli.js"),
      "--platform",
      "android",
      schema,
      path.join(library, "specs"),
    ]);
    run([
      path.join(reactNative, "scripts/generate-specs-cli.js"),
      "--platform",
      "android",
      "--schemaPath",
      schema,
      "--outputDir",
      out,
      "--libraryName",
      "FarmAppSpec",
      "--javaPackageName",
      "dev.farmjs.mobile.specs",
    ]);
    const spec = await readFile(
      path.join(out, "java/dev/farmjs/mobile/specs/NativeDeviceSpec.java"),
      "utf8",
    );
    expect(spec).toContain('public static final String NAME = "Device";');
    expect(spec).toContain("public abstract void model(Promise promise);");
    expect(spec).toContain("public abstract void vibrate(double ms, Promise promise);");
    // The JNI library React Native's app CMake adds, and the provider OnLoad.cpp reaches.
    const cmake = await readFile(path.join(out, "jni/CMakeLists.txt"), "utf8");
    expect(cmake).toContain("react_codegen_FarmAppSpec");
    expect(await readFile(path.join(out, "jni/FarmAppSpec.h"), "utf8")).toContain(
      "FarmAppSpec_ModuleProvider",
    );
    // The example's class overrides exactly those methods.
    const kotlin = await readFile(path.join(dir, "DeviceModule.kt"), "utf8");
    expect(kotlin).toContain(": NativeDeviceSpec(reactContext)");
    expect(kotlin).toContain("override fun model(promise: Promise)");
    expect(kotlin).toContain("override fun vibrate(ms: Double, promise: Promise)");
  });

  describe("web screens' calls to app modules", () => {
    const EXAMPLE = fileURLToPath(new URL("../../../../examples/mobile/", import.meta.url));
    const MAIN = "app/src/main/java/dev/farmjs/mobile/shell/MainActivity.kt";
    const KITCHEN_SPEC = `import { TurboModuleRegistry, type TurboModule, type CodegenTypes } from "react-native";

export type Mode = "light" | "dark";
export type Point = { x: number; y?: number | null };
export enum Level {
  Low = 1,
  High = 2,
}

export interface Spec extends TurboModule {
  scalars(s: string, n: number, b: boolean, i: CodegenTypes.Int32): Promise<string>;
  shapes(mode: Mode, point: Point, tags: Array<string>, extra: Object, note?: string | null): Promise<Point>;
  optional(n?: number, b?: boolean | null, points?: ReadonlyArray<Point> | null): Promise<void>;
  levels(level: Level, items: Array<any>): Promise<Array<number>>;
  syncValue(): string;
}

export default TurboModuleRegistry.getEnforcing<Spec>("Kitchen");
`;
    const KITCHEN_MODULE = `package com.example.notes.modules

import com.facebook.react.bridge.ReactApplicationContext
import dev.farmjs.mobile.specs.NativeKitchenSpec

class KitchenModule(reactContext: ReactApplicationContext) : NativeKitchenSpec(reactContext)
`;

    /** What core attaches to an opted-in spec: its Promise methods, read with Codegen. */
    function optIn(
      modules: NonNullable<MobileShellContext["appModules"]>,
      names: string[],
    ): NonNullable<MobileShellContext["appModules"]> {
      return {
        ...modules,
        specs: modules.specs.map((spec) =>
          names.includes(spec.name)
            ? { ...spec, web: readFarmNativeWebSpec({ root: EXAMPLE, file: spec.file }) }
            : spec,
        ),
      };
    }

    const webConfig = (names: string[]) => {
      const base = context().mobile;
      return {
        ...base,
        modules: Object.fromEntries(
          names.map((name) => [name, { permissions: [], usage: {}, web: true }]),
        ),
      };
    };

    it("registers each opted-in module, generated from its Codegen spec", async () => {
      const root = await app({ dependencies: { react: "19.2.8" } });
      const modules = optIn(
        await appModules(root, {
          "NativeDevice.ts": await readFile(
            path.join(EXAMPLE, "src/native/NativeDevice.ts"),
            "utf8",
          ),
          "DeviceModule.kt": DEVICE_MODULE,
          "NativeKitchen.ts": KITCHEN_SPEC,
          "KitchenModule.kt": KITCHEN_MODULE,
        }),
        ["Device", "Kitchen"],
      );
      const files = await generated(
        context({
          root,
          native: native(),
          appModules: modules,
          mobile: webConfig(["Device", "Kitchen"]),
        }),
      );
      const dispatcher = files[WEB_MODULES]!;
      await expect(dispatcher).toMatchFileSnapshot("__snapshots__/web-modules/FarmWebModules.kt");

      // The bridge dispatches only to these modules, and only to their Promise methods.
      expect(dispatcher).toContain(
        "internal fun farmWebModules(): Map<String, FarmPlugin> = listOf<FarmPlugin>(\n    DeviceWebModule,\n    KitchenWebModule,\n).associateBy { it.name }",
      );
      expect(dispatcher).not.toContain("syncValue");
      expect(dispatcher).toContain("else -> throw unknownMethod(method)");
      // Arguments are checked on the main thread before the module runs.
      expect(dispatcher.indexOf("val bound = bind(method, list)")).toBeLessThan(
        dispatcher.indexOf("starter.execute"),
      );
      expect(dispatcher).toContain('FarmCallException("invalid_args", message)');
      expect(files[MAIN]).toContain("        val plugins = farmWebModules()\n");
      expect(files[MAIN]).not.toContain("emptyMap<String, FarmPlugin>()");
      expect(files[ENGINE]).toContain("    internal fun host(): ReactHost? {");
      // Still autolinked and with the PackageList, so the module is the one native screens use.
      expect(files[ENGINE]).toContain(
        "com.facebook.react.PackageList(activity.application).packages",
      );

      // Each call passes exactly the Kotlin types of the Java methods React Native's Codegen
      // generates from the same specs.
      const java = await codegenJava(Object.values(modules.specs).map((spec) => spec.file));
      const calls = [
        ...dispatcher.matchAll(
          /module: (Native\w+Spec), promise: Promise -> module\.(\w+)\(([^\n]*)promise\)/g,
        ),
      ];
      expect(calls.map((call) => `${call[1]}.${call[2]}`)).toEqual([
        "NativeDeviceSpec.model",
        "NativeDeviceSpec.vibrate",
        "NativeDeviceSpec.pickPhoto",
        "NativeKitchenSpec.scalars",
        "NativeKitchenSpec.shapes",
        "NativeKitchenSpec.optional",
        "NativeKitchenSpec.levels",
      ]);
      for (const [, spec, method, args] of calls) {
        const kotlin = [...args!.matchAll(/as ([\w?]+), /g)].map((match) => match[1]);
        expect(kotlin, `${spec}.${method}`).toEqual(java[`${spec}.${method}`]);
      }
    });

    /** Codegen's Java spec methods, as the Kotlin types a caller passes: `Double?` for `@Nullable Double`. */
    async function codegenJava(specs: string[]): Promise<Record<string, string[]>> {
      const dir = await tempDir();
      const reactNative = realpathSync(path.join(EXAMPLE, "node_modules/react-native"));
      const codegen = realpathSync(path.join(reactNative, "../@react-native/codegen"));
      await mkdir(path.join(dir, "specs"), { recursive: true });
      for (const spec of specs) {
        await writeFile(path.join(dir, "specs", path.basename(spec)), await readFile(spec, "utf8"));
      }
      const run = (args: string[]) =>
        execFileSync(process.execPath, args, { cwd: dir, encoding: "utf8" });
      run([
        path.join(codegen, "lib/cli/combine/combine-js-to-schema-cli.js"),
        "--platform",
        "android",
        path.join(dir, "schema.json"),
        path.join(dir, "specs"),
      ]);
      run([
        path.join(reactNative, "scripts/generate-specs-cli.js"),
        "--platform",
        "android",
        "--schemaPath",
        path.join(dir, "schema.json"),
        "--outputDir",
        path.join(dir, "out"),
        "--libraryName",
        "FarmAppSpec",
        "--javaPackageName",
        "dev.farmjs.mobile.specs",
      ]);
      const kotlin: Record<string, string> = {
        String: "String",
        double: "Double",
        boolean: "Boolean",
        Double: "Double",
        Boolean: "Boolean",
        ReadableMap: "ReadableMap",
        ReadableArray: "ReadableArray",
      };
      const methods: Record<string, string[]> = {};
      for (const spec of specs) {
        const name = `${path.basename(spec).replace(/\.\w+$/, "")}Spec`;
        const source = await readFile(
          path.join(dir, "out/java/dev/farmjs/mobile/specs", `${name}.java`),
          "utf8",
        );
        for (const [, method, params] of source.matchAll(
          /public abstract void (\w+)\(([^)]*)Promise promise\);/g,
        )) {
          methods[`${name}.${method}`] = params!
            .split(",")
            .map((param) => param.trim())
            .filter(Boolean)
            .map((param) => {
              const nullable = param.startsWith("@Nullable ");
              const type = param.replace("@Nullable ", "").split(" ")[0]!;
              return `${kotlin[type] ?? `<${type}>`}${nullable ? "?" : ""}`;
            });
        }
      }
      return methods;
    }

    it("leaves the shell as it was when no module opts in", async () => {
      const root = await app({ dependencies: { react: "19.2.8" } });
      const modules = await appModules(root, {
        "NativeDevice.ts": DEVICE_SPEC,
        "DeviceModule.kt": DEVICE_MODULE,
      });
      const files = await generated(context({ root, native: native(), appModules: modules }));
      const plain = await generated(context({ native: native() }));
      expect(files[WEB_MODULES]).toBeUndefined();
      expect(files[MAIN]).toBe(plain[MAIN]);
      expect(files[MAIN]).toContain("val plugins = emptyMap<String, FarmPlugin>()");
      expect(files[ENGINE]).toContain("    private fun host(): ReactHost? {");
      // A module with web: false is not registered either.
      const off = await generated(
        context({
          root,
          native: native(),
          appModules: modules,
          mobile: {
            ...context().mobile,
            modules: { Device: { permissions: [], usage: {}, web: false } },
          },
        }),
      );
      expect(off[WEB_MODULES]).toBeUndefined();
      expect(off[MAIN]).toBe(plain[MAIN]);
    });

    it("names the fix when a module opts in but the Android app has no React Native", async () => {
      const root = await app({ dependencies: { react: "19.2.8" } });
      const modules = optIn(
        await appModules(root, {
          "NativeDevice.ts": await readFile(
            path.join(EXAMPLE, "src/native/NativeDevice.ts"),
            "utf8",
          ),
          "DeviceModule.kt": DEVICE_MODULE,
        }),
        ["Device"],
      );
      await expect(
        createAndroidProject(context({ root, appModules: modules, mobile: webConfig(["Device"]) })),
      ).rejects.toThrow(
        "mobile.modules.Device.web needs React Native in the Android app to run the module, and Farm adds it only when a route has a native screen (page.native.tsx). Add one, or remove web.",
      );
    });
  });

  it("refuses a dependency that is not installed", async () => {
    const root = await app({ dependencies: { "react-native-missing": "1.0.0" } });
    await expect(createAndroidProject(context({ root, native: native() }))).rejects.toThrow(
      /"react-native-missing" is in dependencies but not installed/,
    );
  });
});

describe("mobile.modules", () => {
  const MANIFEST = "app/src/main/AndroidManifest.xml";

  it("declares the permissions mobile.modules lists, once each, after INTERNET", async () => {
    const base = context();
    const files = await generated(
      context({
        mobile: {
          ...base.mobile,
          modules: {
            Device: { permissions: ["android.permission.VIBRATE"], usage: {} },
            "react-native-camera-kit": {
              permissions: ["android.permission.CAMERA", "android.permission.VIBRATE"],
              usage: { NSCameraUsageDescription: "Scans receipts." },
            },
            Network: { permissions: ["android.permission.INTERNET"], usage: {} },
          },
        },
      }),
    );
    expect(files[MANIFEST]).toContain(
      '    <uses-permission android:name="android.permission.INTERNET" />\n' +
        "    <!-- mobile.modules -->\n" +
        '    <uses-permission android:name="android.permission.CAMERA" />\n' +
        '    <uses-permission android:name="android.permission.VIBRATE" />\n\n' +
        "    <application",
    );
    expect(files[MANIFEST]!.match(/android\.permission\.INTERNET/g)).toHaveLength(1);
  });

  it("leaves the manifest as the template without permissions to add", async () => {
    const template = await readFile(
      fileURLToPath(
        new URL("../../templates/android/app/src/main/AndroidManifest.xml", import.meta.url),
      ),
      "utf8",
    );
    const base = context();
    expect((await generated(base))[MANIFEST]).toBe(template);
    const usageOnly = context({
      mobile: {
        ...base.mobile,
        modules: { Device: { permissions: [], usage: { NSCameraUsageDescription: "x" } } },
      },
    });
    expect((await generated(usageOnly))[MANIFEST]).toBe(template);
  });
});
