import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MobileGeneratedFile, MobileShellContext } from "@farm.js/core/mobile";
import {
  type AndroidAutolinking,
  createAutolinkingConfig,
  resolveAndroidAutolinking,
} from "./autolinking.js";
import { createAndroidWebModules } from "./web-modules.js";
import { createBundledAssetFiles } from "../shared/assets.js";
import { createNativeAssetFiles } from "../shared/native-assets.js";
import { createBridgeScript } from "../shared/bridge.js";
import { createPageShellFiles } from "../shared/shells.js";

/** The Kotlin package of the shell's code. The app's `mobile.id` is only its application ID. */
export const SHELL_NAMESPACE = "dev.farmjs.mobile.shell";
export const MAIN_ACTIVITY = `${SHELL_NAMESPACE}.MainActivity`;

/** Static project files, copied as they are. */
export const TEMPLATE_DIR = fileURLToPath(new URL("../../templates/android/", import.meta.url));

/** Files added or replaced for apps with React Native screens. */
export const REACT_NATIVE_TEMPLATE_DIR = fileURLToPath(
  new URL("../../templates/android-react-native/", import.meta.url),
);

/**
 * Files replaced for apps that link native modules (RFC 0004, 7.5): libappmodules.so built with
 * React Native's app setup and the autolinked modules.
 */
export const REACT_NATIVE_MODULES_TEMPLATE_DIR = fileURLToPath(
  new URL("../../templates/android-react-native-modules/", import.meta.url),
);

/**
 * The toolchain of React Native's Gradle plugin, which an app that links native modules builds
 * with: modules apply the plugin for codegen, and it is built against this Android Gradle plugin
 * and Gradle. Apps without native modules keep the shell's own toolchain.
 */
export const REACT_NATIVE_PLUGIN_AGP = "9.2.1";
const REACT_NATIVE_PLUGIN_GRADLE = {
  version: "9.4.1",
  sha256: "2ab2958f2a1e51120c326cad6f385153bb11ee93b3c216c5fccebfdfbb7ec6cb",
};

/**
 * The mobile client's files (`farm build --mobile`), served for the server origin's paths by
 * `BundledAssets.kt`, and the list it reads.
 */
export const BUNDLED_ASSETS_DIR = "app/src/main/assets/farm-www";
export const BUNDLED_ASSETS_MANIFEST = "app/src/main/assets/farm-assets.json";
/** Page shells (`mobile.shells`), read by `PageShells.kt`; `farm-routes.json` maps routes to them. */
export const PAGE_SHELLS_DIR = "app/src/main/assets/farm-shells";

/** The Hermes bytecode asset the React Native engine loads (`ReactNativeEngine.BUNDLE_ASSET`). */
export const NATIVE_BUNDLE_ASSET = "app/src/main/assets/farm-native.hbc";
/** Where the images React Native screens import go: Android resources (`drawable-<density>/`). */
const NATIVE_RESOURCES = "app/src/main/res";

/**
 * React Native's Android artifacts are built with Kotlin 2.2, whose metadata Kotlin 2.0 cannot
 * read, so a project with React Native screens compiles with this Kotlin.
 */
const REACT_NATIVE_KOTLIN = "2.2.21";

/**
 * 64-bit ABIs only: React Native ships one native library set per ABI, and each costs megabytes.
 * Covers 64-bit phones and the x86_64 emulator images.
 */
const REACT_NATIVE_ABIS = ["arm64-v8a", "x86_64"];

/**
 * The NDK React Native 0.88 is built with. A project with React Native screens compiles one small
 * library, `libappmodules.so`, without which React Native cannot reach its core TurboModules.
 * Gradle installs this NDK and CMake on the first build when the SDK licenses are accepted.
 */
export const REACT_NATIVE_NDK = "27.1.12297006";

/** The app's SDK levels, which linked native modules build against too. */
const COMPILE_SDK = 35;
const MIN_SDK = 26;
const TARGET_SDK = 35;
/** The Android Gradle plugin 9.2.1's default build tools, which it installs on the first build. */
const REACT_NATIVE_PLUGIN_BUILD_TOOLS = "36.0.0";

const EXECUTABLES = new Set(["gradlew"]);

const NATIVE_ENGINE = "app/src/main/java/dev/farmjs/mobile/shell/NativeEngine.kt";

/** Tab icons the shell ships, and the names (including SF Symbols) that map to them. */
const BUILT_IN_ICONS = new Set(["home", "notes", "person", "search", "settings"]);
const ICON_ALIASES: Record<string, string> = {
  gear: "settings",
  gearshape: "settings",
  house: "home",
  magnifyingglass: "search",
  note: "notes",
  "note.text": "notes",
  person: "person",
  "person.crop.circle": "person",
};

/** The built-in drawable for a `mobile.tabs[].icon`, or the generic tab icon. */
export function resolveTabIcon(icon: string): string {
  const name = icon.toLowerCase().replace(/^ic_/, "");
  const builtIn = ICON_ALIASES[name] ?? name;
  return BUILT_IN_ICONS.has(builtIn) ? `ic_${builtIn}` : "ic_tab";
}

/** Text for an Android string resource. */
export function escapeAndroidString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/^([@?])/, "\\$1");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const GENERATED =
  "Generated by @farm.js/mobile/android on every farm dev|build --mobile. Do not edit.";
// XML comments may not contain "--".
const XML_GENERATED =
  "Generated by @farm.js/mobile/android on every mobile dev or build. Do not edit.";

export function createRootBuildGradle(
  context: MobileShellContext,
  linking?: AndroidAutolinking,
): string {
  if (linking) {
    return `// ${GENERATED}
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // React Native's Gradle plugin, from the app's install (settings.gradle.kts), and the
        // Android Gradle plugin it is built against.
        classpath("com.android.tools.build:gradle:${REACT_NATIVE_PLUGIN_AGP}")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${REACT_NATIVE_KOTLIN}")
        classpath("com.facebook.react:react-native-gradle-plugin")
    }
}

// Native modules read these from rootProject.ext, as in a React Native app. Without them each
// module falls back to its own defaults, such as compileSdk 33, which React Native rejects.
extra["compileSdkVersion"] = ${COMPILE_SDK}
extra["minSdkVersion"] = ${MIN_SDK}
extra["targetSdkVersion"] = ${TARGET_SDK}
extra["buildToolsVersion"] = ${JSON.stringify(REACT_NATIVE_PLUGIN_BUILD_TOOLS)}
extra["ndkVersion"] = ${JSON.stringify(REACT_NATIVE_NDK)}
extra["kotlinVersion"] = ${JSON.stringify(REACT_NATIVE_KOTLIN)}

apply(plugin = "com.facebook.react.rootproject")
`;
  }
  const kotlin = context.native ? REACT_NATIVE_KOTLIN : "2.0.21";
  return `plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "${kotlin}" apply false
}
`;
}

export function createAppBuildGradle(
  context: MobileShellContext,
  linking?: AndroidAutolinking,
): string {
  const native = context.native;
  const abis = native
    ? `

        ndk {
            abiFilters += listOf(${REACT_NATIVE_ABIS.map((abi) => JSON.stringify(abi)).join(", ")})
        }

        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared")
            }
        }`
    : "";
  // libappmodules.so, linked against React Native's prefab packages.
  const nativeBuild = native
    ? `

    ndkVersion = ${JSON.stringify(REACT_NATIVE_NDK)}

    buildFeatures {
        prefab = true
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/jni/CMakeLists.txt")
        }
    }

    packaging {
        jniLibs {
            // Shipped by react-android and by the NDK for libappmodules.so.
            pickFirsts += listOf("**/libc++_shared.so", "**/libfbjni.so")
        }
    }`
    : "";
  const reactNative = native
    ? `
    // React Native screens (page.native.tsx): Hermes, Fabric, and bridgeless TurboModules.
    implementation("com.facebook.react:react-android:${native.reactNativeVersion}")
    implementation("com.facebook.hermes:hermes-android:${native.hermesVersion}")`
    : "";
  const reactPlugin = linking
    ? `
    id("com.facebook.react")`
    : "";
  // Paths into the app's install: Farm's project lives in .farm/output/mobile/android.
  const reactConfig = linking
    ? `

react {
    root = file(${JSON.stringify(linking.root)})
    reactNativeDir = file(${JSON.stringify(linking.reactNativeDir)})
    codegenDir = file(${JSON.stringify(linking.codegenDir)})
    // Farm bundles the screens itself (farm-native.hbc), so React Native never bundles JS.
    debuggableVariants = listOf("debug", "release")
    autolinkLibrariesWithApp()
}`
    : "";
  return `// ${GENERATED}
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")${reactPlugin}
}

android {
    namespace = ${JSON.stringify(SHELL_NAMESPACE)}
    compileSdk = ${COMPILE_SDK}

    defaultConfig {
        applicationId = ${JSON.stringify(context.mobile.id)}
        minSdk = ${MIN_SDK}
        targetSdk = ${TARGET_SDK}
        versionCode = 1
        versionName = "1.0"${abis}
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
    }${nativeBuild}
}${reactConfig}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")${reactNative}
}
`;
}

/**
 * App resources. `farm_dev` is true only under `farm dev --mobile`: it enables the `-e server`
 * and `--ei pool` launch overrides and per-call bridge logs, which a `farm build --mobile` APK
 * (debuggable, with an exported launcher) must never honor. `farm_auth_base_path` is
 * `auth.basePath`, or empty without `auth`: the only routes native screens sign in to.
 */
export function createStrings(context: MobileShellContext): string {
  const startPath = context.basePath || "/";
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${XML_GENERATED} -->
<resources>
    <string name="app_name">${escapeAndroidString(context.mobile.name)}</string>
    <string name="farm_start_path" translatable="false">${escapeAndroidString(startPath)}</string>
    <string name="farm_base_path" translatable="false">${escapeAndroidString(context.basePath)}</string>
    <string name="farm_auth_base_path" translatable="false">${escapeAndroidString(context.authBasePath ?? "")}</string>
    <bool name="farm_dev">${context.command === "dev"}</bool>
    <string name="back">Back</string>
    <string name="close">Close</string>
    <string name="farm_native_missing">The native screen %1$s is not in this build. Farm does not build page.native.tsx screens yet.</string>
    <string name="farm_platform_missing">The platform screen %1$s is not in this build. Farm does not build page.kt screens yet.</string>
</resources>
`;
}

export function createTabIcons(context: MobileShellContext): string {
  const items = context.manifest.tabs
    .map((tab) => `        <item>@drawable/${resolveTabIcon(tab.icon)}</item>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${XML_GENERATED} -->
<resources>
    <array name="farm_tab_icons">${items ? `\n${items}\n    ` : ""}</array>
</resources>
`;
}

/**
 * HTTPS only, except under `farm dev --mobile`: the dev server's host, and loopback for
 * `adb reverse`.
 */
export function createNetworkSecurityConfig(context: MobileShellContext): string {
  const server = new URL(context.manifest.server);
  const cleartext = new Set<string>();
  if (context.command === "dev") {
    if (server.protocol === "http:") cleartext.add(server.hostname.replace(/^\[|\]$/g, ""));
    cleartext.add("localhost");
    cleartext.add("127.0.0.1");
  }
  const domains = [...cleartext]
    .map((host) => `        <domain includeSubdomains="false">${escapeXml(host)}</domain>`)
    .join("\n");
  const devConfig = domains
    ? `\n    <domain-config cleartextTrafficPermitted="true">\n${domains}\n    </domain-config>`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${XML_GENERATED} -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />${devConfig}
</network-security-config>
`;
}

/**
 * Resources for the React Native engine: the dev entry the debug app asks Metro for, and Metro's
 * port (React Native reads `react_native_dev_server_port`).
 */
export function createNativeResources(
  context: MobileShellContext,
  linking?: AndroidAutolinking,
): string {
  const devServer = context.native?.devServer;
  // React Native's Gradle plugin writes the port resource itself (gradle.properties).
  const port = linking
    ? ""
    : `
    <integer name="react_native_dev_server_port">${devServer?.port ?? 8081}</integer>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${XML_GENERATED} -->
<resources>
    <string name="farm_native_main_module" translatable="false">${escapeAndroidString(devServer?.mainModule ?? "index")}</string>${port}
</resources>
`;
}

/** Settings that load React Native's Gradle plugin from the app's install and link the modules. */
export function createReactNativeSettings(linking: AndroidAutolinking): string {
  const plugin = JSON.stringify(linking.gradlePluginDir);
  return `// ${GENERATED}
pluginManagement {
    includeBuild(${plugin})
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("com.facebook.react.settings")
}

dependencyResolutionManagement {
    // Native modules declare their own repositories, which settings repositories would reject.
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
    }
}

extensions.configure<com.facebook.react.ReactSettingsExtension> {
    autolinkLibrariesFromConfigFile(file("autolinking.json"))
}

rootProject.name = "FarmMobileShell"
include(":app")
includeBuild(${plugin})
`;
}

/** Gradle properties for React Native's Gradle plugin, appended to the shell's own. */
function createReactNativeGradleProperties(
  context: MobileShellContext,
  properties: string,
): string {
  return `${properties}
# React Native's Gradle plugin (apps that link native modules): it applies Kotlin itself and
# uses the Android Gradle plugin's previous DSL, and writes Metro's port resource.
android.builtInKotlin=false
android.newDsl=false
reactNativeDevServerPort=${context.native?.devServer?.port ?? 8081}
`;
}

function createReactNativeGradleWrapper(): string {
  return `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-${REACT_NATIVE_PLUGIN_GRADLE.version}-bin.zip
distributionSha256Sum=${REACT_NATIVE_PLUGIN_GRADLE.sha256}
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;
}

const PACKAGE_LIST_FROM = "packageList = listOf(MainReactPackage(), FarmShellPackage()),";
// React Native's Gradle plugin generates PackageList in com.facebook.react, whatever the app's
// package is.
const PACKAGE_LIST_TO =
  "packageList = com.facebook.react.PackageList(activity.application).packages + FarmShellPackage(),";

/** The engine with the autolinked packages; `PackageList` includes `MainReactPackage`. */
function linkPackageList(engine: MobileGeneratedFile): MobileGeneratedFile {
  const source = String(engine.contents);
  if (!source.includes(PACKAGE_LIST_FROM)) {
    throw new Error(`NativeEngine.kt no longer contains "${PACKAGE_LIST_FROM}".`);
  }
  return { ...engine, contents: source.replace(PACKAGE_LIST_FROM, PACKAGE_LIST_TO) };
}

const ANDROID_MANIFEST = "app/src/main/AndroidManifest.xml";
const INTERNET_PERMISSION = '    <uses-permission android:name="android.permission.INTERNET" />\n';

/**
 * The manifest with the permissions `mobile.modules` lists, after the shell's own `INTERNET`.
 * Community modules merge their own manifest's permissions; these are the app's extra ones.
 * Without any, the manifest is the template unchanged.
 */
function addManifestPermissions(
  manifest: MobileGeneratedFile,
  context: MobileShellContext,
): MobileGeneratedFile {
  // A core from before `mobile.modules` resolves no `modules` entry.
  const modules = Object.values(context.mobile.modules ?? {});
  const permissions = [...new Set(modules.flatMap((module) => module.permissions))]
    .filter((permission) => permission !== "android.permission.INTERNET")
    .sort();
  if (permissions.length === 0) return manifest;
  const source = String(manifest.contents);
  if (!source.includes(INTERNET_PERMISSION)) {
    throw new Error(`AndroidManifest.xml no longer contains "${INTERNET_PERMISSION.trim()}".`);
  }
  const lines = permissions
    .map((permission) => `    <uses-permission android:name="${permission}" />\n`)
    .join("");
  return {
    ...manifest,
    contents: source.replace(
      INTERNET_PERMISSION,
      `${INTERNET_PERMISSION}    <!-- mobile.modules -->\n${lines}`,
    ),
  };
}

async function readTemplateFiles(dir: string, prefix = ""): Promise<MobileGeneratedFile[]> {
  const files: MobileGeneratedFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const source = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readTemplateFiles(source, relative)));
    } else if (entry.isFile()) {
      const binary = entry.name.endsWith(".jar") || entry.name.endsWith(".hbc");
      files.push({
        path: relative,
        contents: binary ? new Uint8Array(await readFile(source)) : await readFile(source, "utf8"),
        ...(EXECUTABLES.has(relative) ? { executable: true } : {}),
      });
    }
  }
  return files;
}

/** The Gradle project for `.farm/output/mobile/android`, sorted by path. */
export async function createAndroidProject(
  context: MobileShellContext,
): Promise<MobileGeneratedFile[]> {
  const byPath = new Map<string, MobileGeneratedFile>();
  const add = (file: MobileGeneratedFile) => byPath.set(file.path, file);
  (await readTemplateFiles(TEMPLATE_DIR)).forEach(add);
  // React Native, its engine, and the screens' bytecode only when a route has a native screen.
  const linking = await resolveAndroidAutolinking(context);
  if (context.native) {
    (await readTemplateFiles(REACT_NATIVE_TEMPLATE_DIR)).forEach(add);
    add({
      path: "app/src/main/res/values/farm_native.xml",
      contents: createNativeResources(context, linking),
    });
    if (context.native.bundle) {
      add({
        path: NATIVE_BUNDLE_ASSET,
        contents: new Uint8Array(await readFile(context.native.bundle)),
      });
    }
  }
  // Native modules: React Native's Gradle plugin and toolchain, only when the app links one.
  if (linking) {
    (await readTemplateFiles(REACT_NATIVE_MODULES_TEMPLATE_DIR)).forEach(add);
    const engine = byPath.get(NATIVE_ENGINE);
    if (engine) add(linkPackageList(engine));
    const properties = String(byPath.get("gradle.properties")?.contents ?? "");
    add({
      path: "gradle.properties",
      contents: createReactNativeGradleProperties(context, properties),
    });
    add({
      path: "gradle/wrapper/gradle-wrapper.properties",
      contents: createReactNativeGradleWrapper(),
    });
    add({ path: "settings.gradle.kts", contents: createReactNativeSettings(linking) });
    add({
      path: "autolinking.json",
      contents: createAutolinkingConfig(context, linking, {
        packageName: SHELL_NAMESPACE,
        mainActivity: MAIN_ACTIVITY,
      }),
    });
    linking.appModuleFiles?.forEach(add);
  }
  // Web screens' calls to app modules with mobile.modules.<name>.web; nothing without one.
  createAndroidWebModules(context, byPath).forEach(add);
  const manifest = byPath.get(ANDROID_MANIFEST);
  if (manifest) add(addManifestPermissions(manifest, context));
  const files = [...byPath.values()];
  files.push(
    ...(await createBundledAssetFiles(context.assets, {
      root: BUNDLED_ASSETS_DIR,
      manifest: BUNDLED_ASSETS_MANIFEST,
    })),
    ...createPageShellFiles(context.shells, PAGE_SHELLS_DIR),
  );
  files.push(
    { path: "build.gradle.kts", contents: createRootBuildGradle(context, linking) },
    { path: "app/build.gradle.kts", contents: createAppBuildGradle(context, linking) },
    { path: "app/src/main/assets/farm-bridge.js", contents: await createBridgeScript("android") },
    {
      path: "app/src/main/assets/farm-routes.json",
      contents: `${JSON.stringify(context.manifest, null, 2)}\n`,
    },
    { path: "app/src/main/res/values/strings.xml", contents: createStrings(context) },
    { path: "app/src/main/res/values/tabs.xml", contents: createTabIcons(context) },
    {
      path: "app/src/main/res/xml/network_security_config.xml",
      contents: createNetworkSecurityConfig(context),
    },
  );
  // The images the screens require(): resources React Native finds by name, as Metro named them.
  const shellFiles = new Set(files.map((file) => file.path));
  for (const file of await createNativeAssetFiles(context.native?.assetsDir, NATIVE_RESOURCES)) {
    if (shellFiles.has(file.path)) {
      throw new Error(`A native screen's asset would replace the shell's ${file.path}.`);
    }
    files.push(file);
  }
  return files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}
