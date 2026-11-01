import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import type { MobileShellContext } from "@farm.js/core/mobile";
import shell, {
  createAndroidProject,
  listAndroidDevices,
  MAIN_ACTIVITY,
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
      routes: { "/notes/new": { presentation: "modal" }, "/feed": { native: "feed" } },
    },
    manifest: {
      version: 1,
      server: "http://10.0.2.2:3000",
      tabs: [
        { path: "/notes", title: "Notes", icon: "note.text" },
        { path: "/settings", title: "Settings", icon: "gear" },
      ],
      rules: [
        { route: "/notes", pattern: "^/notes/?$", presentation: "tab", tab: 0 },
        { route: "/settings", pattern: "^/settings/?$", presentation: "tab", tab: 1 },
        {
          route: "/feed",
          pattern: "^/feed/?$",
          presentation: "push",
          screen: "native",
          module: "feed",
        },
        { route: "/notes/new", pattern: "^/notes/new/?$", presentation: "modal" },
        { route: "/notes/[id]", pattern: "^/notes/[^/]+/?$", presentation: "push" },
        { pattern: "^/", presentation: "push" },
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
      "app/src/main/java/dev/farmjs/mobile/shell/FarmBridge.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/MainActivity.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/NativeScreens.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/Navigator.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/Page.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/RouteConfig.kt",
      "app/src/main/java/dev/farmjs/mobile/shell/Screen.kt",
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
    expect(files["app/proguard-rules.pro"]).toContain(`${SHELL_NAMESPACE}.FarmBridge$JsInterface`);
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

  it("maps tab icons to the built-in drawables", () => {
    expect(resolveTabIcon("ic_notes")).toBe("ic_notes");
    expect(resolveTabIcon("gear")).toBe("ic_settings");
    expect(resolveTabIcon("house")).toBe("ic_home");
    expect(resolveTabIcon("Search")).toBe("ic_search");
    expect(resolveTabIcon("rocket")).toBe("ic_tab");
  });
});

describe("the bridge script", () => {
  async function loadBridge() {
    const files = await generated(context());
    const source = files["app/src/main/assets/farm-bridge.js"].replace("__FARM_PLUGINS__", "[]");
    const posted: Array<Record<string, unknown>> = [];
    const window: Record<string, any> = {
      FarmNative: { postMessage: (message: string) => posted.push(JSON.parse(message)) },
    };
    const sandbox = {
      window,
      location: { href: "http://10.0.2.2:3000/notes", pathname: "/notes", search: "" },
      document: { title: "Notes", addEventListener() {}, querySelector: () => null },
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
    return { bridge: window.__farmBridge, window, posted };
  }

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
