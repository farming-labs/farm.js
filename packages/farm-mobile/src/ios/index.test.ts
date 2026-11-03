import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import type { MobileShellContext } from "@farm.js/core/mobile";
import shell, {
  createIosProject,
  IOS_DEPLOYMENT_TARGET,
  listBootedSimulators,
  resolveTabSymbol,
} from "./index";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const previousPath = process.env.PATH;
afterEach(async () => {
  process.env.PATH = previousPath;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-mobile-ios-"));
  roots.push(root);
  return root;
}

function context(overrides: Partial<MobileShellContext> = {}): MobileShellContext {
  return {
    root: "/app",
    os: "ios",
    command: "dev",
    basePath: "",
    projectDir: "/app/.farm/output/mobile/ios",
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
    // The shape createFarmMobileRouteManifest writes for iOS: `screen` on every rule, `module`
    // on native and platform screens.
    manifest: {
      version: 1,
      server: "http://localhost:3000",
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
          screen: "web",
          source: "default",
        },
        { pattern: "^/", presentation: "push", screen: "web" },
      ],
    },
    ...overrides,
  };
}

function buildContext(): MobileShellContext {
  const ctx = context({ command: "build" });
  ctx.manifest = { ...ctx.manifest, server: "https://notes.example.com" };
  return ctx;
}

async function generated(ctx: MobileShellContext): Promise<Record<string, string>> {
  return Object.fromEntries(
    (await createIosProject(ctx)).map((file) => [
      file.path,
      typeof file.contents === "string" ? file.contents : `<${file.contents.byteLength} bytes>`,
    ]),
  );
}

async function writeProject(ctx: MobileShellContext): Promise<string> {
  const dir = await tempDir();
  for (const file of await createIosProject(ctx)) {
    const target = path.join(dir, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.contents);
  }
  return dir;
}

const swiftFiles = (files: Record<string, string>) =>
  Object.entries(files).filter(([file]) => file.endsWith(".swift"));

/** A reader for the old-style (OpenStep) plist format of project.pbxproj. */
function parseOpenStep(source: string): unknown {
  let index = 0;
  const skip = () => {
    for (;;) {
      while (/\s/.test(source[index] ?? "")) index += 1;
      if (source.startsWith("//", index)) index = source.indexOf("\n", index) + 1 || source.length;
      else if (source.startsWith("/*", index)) index = source.indexOf("*/", index) + 2;
      else return;
    }
  };
  const expect = (character: string) => {
    skip();
    if (source[index] !== character) {
      throw new Error(`Expected ${character} at ${index}: ${source.slice(index, index + 40)}`);
    }
    index += 1;
  };
  const value = (): unknown => {
    skip();
    const character = source[index];
    if (character === "{") {
      index += 1;
      const object: Record<string, unknown> = {};
      for (skip(); source[index] !== "}"; skip()) {
        const key = value() as string;
        expect("=");
        if (key in object) throw new Error(`Duplicate key ${key}`);
        object[key] = value();
        expect(";");
      }
      index += 1;
      return object;
    }
    if (character === "(") {
      index += 1;
      const array: unknown[] = [];
      for (skip(); source[index] !== ")"; skip()) {
        array.push(value());
        skip();
        if (source[index] === ",") index += 1;
      }
      index += 1;
      return array;
    }
    if (character === '"') {
      let text = "";
      for (index += 1; source[index] !== '"'; index += 1) {
        if (source[index] === "\\") index += 1;
        text += source[index];
      }
      index += 1;
      return text;
    }
    const match = /^[A-Za-z0-9_$/.:-]+/.exec(source.slice(index));
    if (!match) throw new Error(`Unexpected ${source.slice(index, index + 40)}`);
    index += match[0].length;
    return match[0];
  };
  const root = value();
  skip();
  if (index !== source.length) throw new Error(`Trailing content at ${index}`);
  return root;
}

type PbxObject = Record<string, any>;

function parseProject(files: Record<string, string>) {
  const project = parseOpenStep(files["App.xcodeproj/project.pbxproj"]) as {
    objects: Record<string, PbxObject>;
    rootObject: string;
    objectVersion: string;
  };
  const objects = project.objects;
  const ofType = (isa: string) =>
    Object.entries(objects).filter(([, object]) => object.isa === isa);
  return { project, objects, ofType };
}

describe("@farm.js/mobile/ios", () => {
  it("is the iOS shell", () => {
    expect(shell.os).toBe("ios");
    expect(IOS_DEPLOYMENT_TARGET).toBe("16.0");
  });

  it("generates the Xcode project, sorted and the same every time", async () => {
    const files = await createIosProject(context());
    expect(files.map((file) => file.path)).toEqual([
      "App.xcodeproj/project.pbxproj",
      "App.xcodeproj/project.xcworkspace/contents.xcworkspacedata",
      "App.xcodeproj/xcshareddata/xcschemes/App.xcscheme",
      "App/AppDelegate.swift",
      "App/Assets.xcassets/AccentColor.colorset/Contents.json",
      "App/Assets.xcassets/AppIcon.appiconset/AppIcon.png",
      "App/Assets.xcassets/AppIcon.appiconset/Contents.json",
      "App/Assets.xcassets/Contents.json",
      "App/Assets.xcassets/LaunchBackground.colorset/Contents.json",
      "App/FarmBridge.swift",
      "App/FarmBuild.swift",
      "App/Info.plist",
      "App/MobileSession.swift",
      "App/NativeScreens.swift",
      "App/Navigator.swift",
      "App/Page.swift",
      "App/RouteConfig.swift",
      "App/SceneDelegate.swift",
      "App/ScreenViewController.swift",
      "App/Theme.swift",
      "App/WebViewPool.swift",
      "App/farm-bridge.js",
      "App/farm-routes.json",
    ]);
    expect(files.filter((file) => file.executable)).toEqual([]);
    const icon = files.find((file) => file.path.endsWith("AppIcon.png"))!.contents as Uint8Array;
    expect(icon).toBeInstanceOf(Uint8Array);
    // A PNG, 1024 x 1024, RGB without alpha (the App Store rejects icons with alpha).
    const png = Buffer.from(icon);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(png[25]).toBe(2);
    expect(await generated(context())).toEqual(await generated(context()));
    // Asset catalog files are JSON.
    for (const [file, source] of Object.entries(await generated(context()))) {
      if (file.endsWith(".json")) expect(() => JSON.parse(source)).not.toThrow();
    }
  });

  it("consumes the manifest: bundle ID, routes, app name, start path, and tab icons", async () => {
    const files = await generated(context());
    expect(JSON.parse(files["App/farm-routes.json"])).toEqual(context().manifest);
    expect(files["App/Info.plist"]).toContain(
      "<key>CFBundleDisplayName</key>\n\t<string>Farm &quot;Notes&quot; &amp; Co</string>",
    );
    expect(files["App/Info.plist"]).toContain(
      "<key>CFBundleIdentifier</key>\n\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>",
    );
    expect(files["App/FarmBuild.swift"]).toContain('static let startPath = "/"');
    expect(files["App/FarmBuild.swift"]).toContain(
      'static let tabIcons: [String] = ["note.text", "gearshape"]',
    );
    const { ofType } = parseProject(files);
    for (const [, config] of ofType("XCBuildConfiguration")) {
      if (!config.buildSettings.INFOPLIST_FILE) continue;
      expect(config.buildSettings.PRODUCT_BUNDLE_IDENTIFIER).toBe("com.example.notes");
      expect(config.buildSettings.MARKETING_VERSION).toBe("1.0");
      expect(config.buildSettings.CURRENT_PROJECT_VERSION).toBe("1");
      expect(config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET).toBeUndefined();
    }

    const base = context({ basePath: "/docs" });
    base.manifest = { ...base.manifest, tabs: [] };
    const baseFiles = await generated(base);
    expect(baseFiles["App/FarmBuild.swift"]).toContain('static let startPath = "/docs"');
    expect(baseFiles["App/FarmBuild.swift"]).toContain("static let tabIcons: [String] = []");
  });

  it("writes a project file whose objects all resolve, with every source and resource built", async () => {
    const files = await generated(context());
    const { project, objects, ofType } = parseProject(files);
    expect(project.objectVersion).toBe("56");
    expect(objects[project.rootObject]!.isa).toBe("PBXProject");
    // Every object id is 24 hex digits, and every id-shaped value points at an object.
    const ids = Object.keys(objects);
    for (const id of ids) expect(id).toMatch(/^[0-9A-F]{24}$/);
    const references = JSON.stringify(objects).match(/"[0-9A-F]{24}"/g) ?? [];
    for (const reference of references) expect(ids).toContain(JSON.parse(reference));

    const [[, target]] = ofType("PBXNativeTarget") as [[string, PbxObject]];
    expect(target.productType).toBe("com.apple.product-type.application");
    const phase = (isa: string) =>
      target.buildPhases
        .map((id: string) => objects[id])
        .find((object: PbxObject) => object.isa === isa);
    const built = (isa: string) =>
      phase(isa)
        .files.map((id: string) => objects[objects[id]!.fileRef]!.path)
        .sort();
    const swift = swiftFiles(files)
      .map(([file]) => file.slice("App/".length))
      .sort();
    expect(built("PBXSourcesBuildPhase")).toEqual(swift);
    expect(built("PBXResourcesBuildPhase")).toEqual([
      "Assets.xcassets",
      "farm-bridge.js",
      "farm-routes.json",
    ]);
    // The App group lists exactly the entries under App/, and Info.plist is not a resource.
    const [, group] = ofType("PBXGroup").find(([, object]) => object.path === "App")!;
    const entries = new Set(
      Object.keys(files)
        .filter((file) => file.startsWith("App/"))
        .map((file) => file.split("/")[1]),
    );
    expect(group.children.map((id: string) => objects[id]!.path).sort()).toEqual(
      [...entries].sort(),
    );
    for (const [, config] of ofType("XCBuildConfiguration")) {
      const infoPlist = config.buildSettings.INFOPLIST_FILE;
      if (infoPlist) expect(files[infoPlist]).toBeDefined();
    }
    // The shared scheme builds that target.
    const targetId = ofType("PBXNativeTarget")[0]![0];
    expect(files["App.xcodeproj/xcshareddata/xcschemes/App.xcscheme"]).toContain(
      `BlueprintIdentifier = "${targetId}"`,
    );
  });

  it("allows plain HTTP only for local networking and the dev host under farm dev", async () => {
    const dev = (await generated(context()))["App/Info.plist"];
    expect(dev).toContain("<key>NSAppTransportSecurity</key>");
    expect(dev).toContain("<key>NSAllowsLocalNetworking</key>\n\t\t<true/>");
    expect(dev).toContain("<key>localhost</key>");
    expect(dev).not.toContain("NSAllowsArbitraryLoads");
    const lan = context();
    lan.manifest = { ...lan.manifest, server: "http://devbox.example:3000" };
    expect((await generated(lan))["App/Info.plist"]).toContain("<key>devbox.example</key>");
    const ip = context();
    ip.manifest = { ...ip.manifest, server: "http://192.168.1.20:3000" };
    expect((await generated(ip))["App/Info.plist"]).not.toContain("192.168.1.20");

    const build = (await generated(buildContext()))["App/Info.plist"];
    expect(build).not.toContain("NSAppTransportSecurity");
    expect(build).not.toContain("NSExceptionDomains");
    expect(build).not.toContain("NSLocalNetworkUsageDescription");
  });

  it("registers the bridge only with origin and main-frame checks, and evaluates only into the app", async () => {
    const files = await generated(context());
    const registration = /addScriptMessageHandler|\.add\([^)]*\bname:/;
    for (const [file, source] of Object.entries(files)) {
      if (!registration.test(source)) continue;
      // Every file that registers a message handler checks the frame and its origin.
      expect(file).toBe("App/FarmBridge.swift");
      expect(source).toContain("message.frameInfo.isMainFrame");
      expect(source).toContain("message.frameInfo.securityOrigin");
    }
    const bridge = files["App/FarmBridge.swift"];
    expect(bridge.match(new RegExp(registration, "g"))).toHaveLength(1);
    expect(bridge).toContain(
      "controller.add(self, contentWorld: .page, name: FarmBridge.handlerName)",
    );
    expect(bridge).not.toContain("WKScriptMessageHandlerWithReply");
    // The handler drops anything before parsing it unless it comes from the app's main frame.
    const handler = bridge.slice(
      bridge.indexOf("didReceive message: WKScriptMessage"),
      bridge.indexOf("handle(raw)"),
    );
    expect(handler).toMatch(
      /guard message\.frameInfo\.isMainFrame,\s+FarmBridge\.origin\(of: message\.frameInfo\.securityOrigin\) == config\.origin,\s+message\.webView === webView,/,
    );
    // The document-start script is main frame only and guarded by the app origin.
    expect(bridge).toContain(
      "WKUserScript(source: scoped, injectionTime: .atDocumentStart, forMainFrameOnly: true)",
    );
    expect(bridge).toContain(
      'let scoped = "if (location.origin === \\(FarmBridge.jsString(config.origin))) {\\n\\(source)\\n}"',
    );
    // Replies only go into a page on the app origin.
    for (const [file, source] of swiftFiles(files)) {
      if (file !== "App/FarmBridge.swift") expect(source).not.toContain("evaluateJavaScript(");
    }
    expect(bridge).toMatch(
      /guard let webView, let current = webView\.url, config\.isAppURL\(current\) else \{ return \}\n\s+webView\.evaluateJavaScript\(/,
    );
    // Malformed messages are dropped: no force unwraps or force casts on message fields.
    expect(bridge).not.toMatch(/message\[[^\]]+\]!|as! /);
    expect(bridge).toContain("if FarmBuild.dev {");
  });

  it("keeps the device session in the Keychain on this device only, out of every WebView", async () => {
    const files = await generated({ ...context(), basePath: "/docs" });
    const session = files["App/MobileSession.swift"]!;
    expect(session).toContain("kSecClassGenericPassword");
    expect(session).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(session).not.toMatch(/kSecAttrSynchronizable|UserDefaults/);
    // Its own cookie-less URLSession: nothing it sends or receives lands in a shared jar.
    expect(session).toContain("configuration.httpCookieStorage = nil");
    expect(session).toContain("configuration.httpCookieAcceptPolicy = .never");
    expect(session).toContain('request.setValue(appId, forHTTPHeaderField: "X-Farm-Mobile")');
    expect(session).not.toMatch(/evaluateJavaScript|"Origin"/);
    for (const endpoint of ["challenge", "refresh", "revoke"]) {
      expect(session).toContain(`"/__farm/mobile/session/${endpoint}"`);
    }
    expect(session).toContain('private static let marker = "farm_mobile"');
    expect(files["App/FarmBuild.swift"]).toContain('static let basePath = "/docs"');
    expect(files["App/SceneDelegate.swift"]).toContain("MobileSession.start(config: config)");
    expect(files["App/Page.swift"]!.match(/MobileSession\.shared\?\.sync\(\)/g)).toHaveLength(2);
  });

  it("sets FarmBuild.dev only under farm dev, and reads launch overrides only when it is set", async () => {
    const farmBuild = async (ctx: MobileShellContext) =>
      (await generated(ctx))["App/FarmBuild.swift"];
    expect(await farmBuild(context())).toContain("static let dev = true");
    expect(await farmBuild(buildContext())).toContain("static let dev = false");

    const files = await generated(buildContext());
    const scene = files["App/SceneDelegate.swift"];
    for (const [file, source] of swiftFiles(files)) {
      if (file !== "App/SceneDelegate.swift") {
        expect(source).not.toContain("ProcessInfo.processInfo.arguments");
        expect(source).not.toContain("UserDefaults");
      }
    }
    expect(scene).toContain(
      "LaunchOptions.read(arguments: ProcessInfo.processInfo.arguments, dev: FarmBuild.dev)",
    );
    expect(scene.match(/ProcessInfo\.processInfo\.arguments/g)).toHaveLength(1);
    // The first statement of read() returns the defaults outside dev builds.
    const read = scene.slice(scene.indexOf("static func read("));
    expect(read).toMatch(
      /^static func read\(arguments: \[String\], dev: Bool\) -> LaunchOptions \{\n\s+guard dev else \{ return LaunchOptions\(server: nil, pool: poolSize\) \}/,
    );
    const guard = read.indexOf("guard dev else");
    for (const name of ['"-FarmServer"', '"-FarmPool"']) {
      expect(scene.indexOf(name)).toBeGreaterThan(scene.indexOf("static func read(") + guard);
    }
  });

  it("reads screen on every rule, tab roots included, with module ids from the route", async () => {
    const files = await generated(context());
    const routes = files["App/RouteConfig.swift"];
    expect(routes).toContain(
      'private static let screens: Set<String> = [web, "native", "platform"]',
    );
    expect(routes).toContain(
      'let screen = (json["screen"] as? String).flatMap { screens.contains($0) ? $0 : nil } ?? web',
    );
    expect(routes).toContain("var isNative: Bool { screen != RouteConfig.web }");
    expect(routes).toContain('route.map { $0 == "/" ? "app" : "app\\($0)" }');
    const navigator = files["App/Navigator.swift"];
    expect(navigator).toContain("makeScreen(isModal: false, rule: config.match(url), url: url)");
    expect(navigator).toContain("if rule.isNative {");
    expect(navigator).toContain("SFSafariViewController(url: url)");
    expect(navigator).toContain("sheet.modalPresentationStyle = .pageSheet");
    expect(navigator).toContain("stack.interactivePopGestureRecognizer?.isEnabled = true");
    // A transition blocks visits only until UIKit ends it or the cap passes: a present()
    // completion that never runs (seen on Mac Catalyst) must not stop navigation for good.
    expect(navigator.match(/transitioning = true/g)).toHaveLength(1);
    expect(navigator).toMatch(
      /private func beginTransition\(\) -> Int \{\n\s+transition \+= 1\n\s+transitioning = true\n\s+let id = transition\n\s+DispatchQueue\.main\.asyncAfter\(deadline: \.now\(\) \+ Navigator\.warmWait \+ Navigator\.transitionCap\)/,
    );
    const screens = files["App/NativeScreens.swift"];
    expect(screens).toContain("Farm does not build page.swift screens yet.");
    expect(screens).toContain("Farm does not build page.native.tsx screens yet.");
    expect(files["App/Page.swift"]).toContain(
      "func webViewWebContentProcessDidTerminate(_ webView: WKWebView)",
    );
  });

  it("loads every app document with the shell header, so it keeps the mobile client", async () => {
    // WKWebView cannot answer https requests from the app, so the iOS project bundles no client
    // files: the mobile client loads from the server and stays in WebKit's cache.
    const assets = { dir: "/app/.farm/client", entry: "/farm-mobile-client-h1a2b3c4d.js", files: ["/farm-mobile-client-h1a2b3c4d.js"] };
    const withAssets = await generated({ ...buildContext(), assets });
    expect(Object.keys(withAssets)).toEqual(Object.keys(await generated(buildContext())));
    expect(Object.keys(withAssets).some((file) => /farm-www|farm-assets|farm-mobile-client/.test(file))).toBe(false);

    const page = withAssets["App/Page.swift"];
    expect(page).toContain('request.setValue("ios", forHTTPHeaderField: Page.shellHeader)');
    expect(page).toContain('static let shellHeader = "X-Farm-Shell"');
    // The one place documents load from, and the policy that sends header-less app documents
    // (redirects, router fallbacks, reloads) through it.
    expect(page.match(/webView\.load\(/g)).toHaveLength(1);
    expect(page).toMatch(
      /if decision == \.allow, let url = navigationAction\.request\.url, needsShellHeader\(navigationAction, url\) \{\n\s+decisionHandler\(\.cancel\)\n\s+load\(url\)/,
    );
    expect(page).toContain("action.navigationType != .backForward");
    expect(page).toContain('(action.request.httpMethod ?? "GET").uppercased() == "GET"');
    expect(page).toContain("action.request.value(forHTTPHeaderField: Page.shellHeader) == nil");
  });

  it("uses the Android shell's colors", async () => {
    const theme = (await generated(context()))["App/Theme.swift"];
    const androidDir = fileURLToPath(
      new URL("../../templates/android/app/src/main/res", import.meta.url),
    );
    const colors = async (dir: string) =>
      Object.fromEntries(
        [
          ...(await readFile(path.join(androidDir, dir, "colors.xml"), "utf8")).matchAll(
            /<color name="farm_(\w+)">#([0-9A-F]{6})<\/color>/g,
          ),
        ].map(([, name, value]) => [name, value]),
      );
    const light = await colors("values");
    const dark = await colors("values-night");
    expect(Object.keys(light).sort()).toEqual(["accent", "background", "surface", "text"]);
    for (const name of Object.keys(light)) {
      expect(theme).toContain(
        `static let ${name} = dynamic(light: 0x${light[name]}, dark: 0x${dark[name]})`,
      );
    }
  });

  it("maps tab icons to SF Symbols", () => {
    expect(resolveTabSymbol("note.text")).toBe("note.text");
    expect(resolveTabSymbol("ic_notes")).toBe("note.text");
    expect(resolveTabSymbol("gear")).toBe("gearshape");
    expect(resolveTabSymbol("Settings")).toBe("gearshape");
    expect(resolveTabSymbol("house")).toBe("house");
    expect(resolveTabSymbol("star.fill")).toBe("star.fill");
  });
});

/** True when `command args` exits 0. */
async function runs(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args);
    return true;
  } catch {
    return false;
  }
}

const hasPlutil = process.platform === "darwin" && (await runs("plutil", ["-help"]));
const hasSwiftc = await runs("swiftc", ["--version"]);

/**
 * An SDK with UIKit and WebKit to type-check against: the iOS Simulator SDK when Xcode is
 * installed, else the macOS SDK's Mac Catalyst frameworks, which the Command Line Tools ship.
 */
async function uikitSdk(): Promise<string[] | undefined> {
  if (process.platform !== "darwin" || !hasSwiftc) return undefined;
  const arch = process.arch === "arm64" ? "arm64" : "x86_64";
  try {
    const { stdout } = await execFileAsync("xcrun", [
      "--sdk",
      "iphonesimulator",
      "--show-sdk-path",
    ]);
    return [
      "-sdk",
      stdout.trim(),
      "-target",
      `${arch}-apple-ios${IOS_DEPLOYMENT_TARGET}-simulator`,
    ];
  } catch {
    // Command Line Tools only.
  }
  try {
    const sdk = (await execFileAsync("xcrun", ["--show-sdk-path"])).stdout.trim();
    const ios = path.join(sdk, "System", "iOSSupport");
    await stat(path.join(ios, "System", "Library", "Frameworks", "UIKit.framework"));
    return [
      "-sdk",
      sdk,
      "-target",
      `${arch}-apple-ios${IOS_DEPLOYMENT_TARGET}-macabi`,
      "-Fsystem",
      path.join(ios, "System", "Library", "Frameworks"),
      "-I",
      path.join(ios, "usr", "lib", "swift"),
    ];
  } catch {
    return undefined;
  }
}

const sdkFlags = await uikitSdk();

describe("generated files on this machine's tools", () => {
  it.skipIf(!hasPlutil)(
    "passes plutil: Info.plist lints, the project file converts",
    async () => {
      for (const ctx of [context(), buildContext()]) {
        const dir = await writeProject(ctx);
        await execFileAsync("plutil", ["-lint", path.join(dir, "App", "Info.plist")]);
        const { stdout } = await execFileAsync("plutil", [
          "-convert",
          "json",
          "-o",
          "-",
          path.join(dir, "App.xcodeproj", "project.pbxproj"),
        ]);
        // plutil reads the project file exactly as this test's parser does.
        expect(JSON.parse(stdout)).toEqual(parseProject(await generated(ctx)).project);
      }
    },
    60_000,
  );

  it.skipIf(!hasSwiftc)(
    "parses every generated Swift file with swiftc -parse",
    async () => {
      const dir = await writeProject(context());
      const files = swiftFiles(await generated(context())).map(([file]) => path.join(dir, file));
      expect(files.length).toBeGreaterThan(5);
      for (const file of files) await execFileAsync("swiftc", ["-parse", file]);
    },
    120_000,
  );

  it.skipIf(!sdkFlags)(
    "type-checks the Swift shell against UIKit and WebKit in Swift 5 and Swift 6 modes",
    async () => {
      for (const ctx of [context(), buildContext()]) {
        const dir = await writeProject(ctx);
        const sources = swiftFiles(await generated(ctx)).map(([file]) => path.join(dir, file));
        for (const [version, defines] of [
          ["5", ["-D", "DEBUG"]],
          ["5", []],
          ["6", ["-D", "DEBUG"]],
        ] as const) {
          const { stderr } = await execFileAsync(
            "swiftc",
            [
              "-typecheck",
              "-swift-version",
              version,
              ...defines,
              ...sdkFlags!,
              "-module-name",
              "App",
              "-parse-as-library",
              ...sources,
            ],
            { maxBuffer: 16 * 1024 * 1024 },
          );
          // A delegate method that only "nearly matches" its requirement is never called.
          expect(stderr).not.toMatch(/error:|warning:/);
        }
      }
    },
    300_000,
  );
});

describe("the bridge script on iOS", () => {
  async function loadBridge(origin = "http://localhost:3000") {
    const files = await generated(context());
    const source = files["App/farm-bridge.js"].replace("__FARM_PLUGINS__", "[]");
    // What FarmBridge.swift installs: the script inside an origin check.
    const scoped = `if (location.origin === ${JSON.stringify("http://localhost:3000")}) {\n${source}\n}`;
    const posted: Array<Record<string, unknown>> = [];
    const window: Record<string, any> = {
      webkit: {
        messageHandlers: {
          farmNative: {
            postMessage: (message: unknown) => {
              // WKScriptMessage bodies are JSON strings, parsed the same way as on Android.
              expect(typeof message).toBe("string");
              posted.push(JSON.parse(message as string));
            },
          },
        },
      },
    };
    const url = new URL("/notes", origin);
    const sandbox = {
      window,
      location: { href: url.href, origin: url.origin, pathname: url.pathname, search: "" },
      document: {
        title: "Notes",
        addEventListener() {},
        querySelector: () => null,
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
    vm.runInNewContext(scoped, sandbox);
    return { bridge: window.__farmBridge, window, posted, root: sandbox.document.documentElement };
  }

  it("is the shared bridge with the iOS name and message port", async () => {
    const files = await generated(context());
    const script = files["App/farm-bridge.js"];
    expect(script).not.toMatch(/__FARM_SHELL_OS__|__FARM_NATIVE_PORT__/);
    expect(script).toContain("window.webkit.messageHandlers.farmNative");
    const android = (await import("../android/templates")).createAndroidProject;
    const androidScript = (await android({ ...context(), os: "android" })).find(
      (file) => file.path === "app/src/main/assets/farm-bridge.js",
    )!.contents as string;
    // One source: the two scripts differ only in the OS name and the port.
    const normalize = (value: string) =>
      value
        .replaceAll('"ios"', '"<os>"')
        .replaceAll('"android"', '"<os>"')
        .replace(
          "window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.farmNative",
          "<port>",
        )
        .replace("window.FarmNative", "<port>");
    expect(normalize(script)).toBe(normalize(androidScript));
  });

  it("marks the page as running in the iOS shell", async () => {
    const { root, bridge } = await loadBridge();
    expect(root.attributes["data-farm-shell"]).toBe("ios");
    expect(bridge.platform).toBe("ios");
  });

  it("does nothing on another origin", async () => {
    const { root, window, posted } = await loadBridge("https://evil.example");
    expect(root.attributes["data-farm-shell"]).toBeUndefined();
    expect(window.__farmBridge).toBeUndefined();
    window.__FARM_SPA_ROUTER__ = { navigate() {} };
    expect(posted).toEqual([]);
  });

  it("takes in-app navigations as visits, except the ones it renders itself", async () => {
    const { bridge, window, posted } = await loadBridge();
    const navigations: string[] = [];
    const delegate = (context: unknown) => bridge.offerNavigation(context) === true;
    window.__FARM_SPA_ROUTER__ = {
      async navigate(href: string, options: { replace?: boolean }) {
        if (delegate({ url: href, action: options.replace ? "replace" : "push" })) return;
        navigations.push(href);
      },
    };
    expect(posted).toContainEqual({
      type: "router-ready",
      url: "http://localhost:3000/notes",
      title: "Notes",
    });
    expect(delegate({ url: "http://localhost:3000/notes/1", action: "push" })).toBe(true);
    expect(posted.filter((message) => message.type === "visit")).toEqual([
      { type: "visit", url: "http://localhost:3000/notes/1", action: "advance" },
    ]);
    bridge.render("http://localhost:3000/notes/7", 3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigations).toEqual(["http://localhost:3000/notes/7"]);
    expect(posted.at(-1)).toMatchObject({ type: "rendered", token: 3 });

    // Native replies resolve and reject calls by id.
    const ok = bridge.call("haptics", "impact", { style: "light" });
    const failed = bridge.call("camera", "takePhoto");
    const calls = posted.filter((message) => message.type === "call");
    expect(calls).toEqual([
      { type: "call", id: 1, plugin: "haptics", method: "impact", args: { style: "light" } },
      { type: "call", id: 2, plugin: "camera", method: "takePhoto", args: {} },
    ]);
    bridge._resolve(1, true, null);
    bridge._resolve(2, false, {
      code: "native_unavailable",
      message: 'No native plugin "camera".',
    });
    await expect(ok).resolves.toBeNull();
    await expect(failed).rejects.toMatchObject({ code: "native_unavailable" });
  });
});

describe("building and running", () => {
  /** Fake xcodebuild and xcrun on PATH that log their arguments. */
  async function fakeXcode(options: { installed: boolean; booted: string }) {
    const bin = await tempDir();
    const log = path.join(bin, "calls.log");
    const write = async (name: string, body: string) => {
      await writeFile(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}`);
      await chmod(path.join(bin, name), 0o755);
    };
    await write(
      "xcodebuild",
      options.installed
        ? 'if [ "$1" = "-version" ]; then echo "Xcode 16.4"; exit 0; fi\n' +
            "mkdir -p build/Build/Products/Debug-iphonesimulator/App.app\n" +
            "echo app > build/Build/Products/Debug-iphonesimulator/App.app/App\n"
        : "echo \"xcode-select: error: tool 'xcodebuild' requires Xcode\" >&2\nexit 1\n",
    );
    await write(
      "xcrun",
      options.installed
        ? `if [ "$1" = "--find" ]; then echo /usr/bin/simctl; exit 0; fi\n` +
            `if [ "$2" = "list" ]; then cat <<'EOF'\n${options.booted}\nEOF\nfi\n`
        : 'echo "xcrun: error: unable to find utility" >&2\nexit 72\n',
    );
    process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
    return async () => (await readFile(log, "utf8").catch(() => "")).trim().split("\n");
  }

  const BOOTED = JSON.stringify({
    devices: {
      "com.apple.CoreSimulator.SimRuntime.watchOS-11-0": [
        { udid: "WATCH", name: "Apple Watch", state: "Booted" },
      ],
      "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
        { udid: "UDID-1", name: "iPhone 16", state: "Booted" },
      ],
    },
  });

  it.skipIf(process.platform !== "darwin")(
    "prints what to install and the commands when Xcode is missing",
    async () => {
      const calls = await fakeXcode({ installed: false, booted: "" });
      const root = await tempDir();
      const ctx = context({
        root,
        projectDir: path.join(root, ".farm", "output", "mobile", "ios"),
      });
      const result = await shell.run(ctx);
      expect(result.launched).toBe(false);
      expect(result.message).toContain(
        "Install Xcode with the iOS 16 or newer SDK from the App Store",
      );
      expect(result.message).toContain(
        "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
      );
      expect(result.message).toContain("xcodebuild -downloadPlatform iOS");
      expect(result.message).toContain(
        "cd .farm/output/mobile/ios && xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath build -quiet build",
      );
      expect(result.message).toContain(
        "xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/App.app",
      );
      expect(result.message).toContain("xcrun simctl launch booted com.example.notes");
      expect(await calls()).toEqual(["xcodebuild -version"]);

      const packaged = await shell.package({ ...ctx, distDir: path.join(root, "dist") });
      expect(packaged.files).toEqual([]);
      expect(packaged.message).toContain("Install Xcode with the iOS 16 or newer SDK");
    },
    30_000,
  );

  it.skipIf(process.platform === "darwin")("explains that iOS apps build on macOS", async () => {
    const root = await tempDir();
    const result = await shell.run(
      context({ root, projectDir: path.join(root, ".farm", "output", "mobile", "ios") }),
    );
    expect(result.launched).toBe(false);
    expect(result.message).toContain("iOS apps build only on macOS with Xcode.");
  });

  it.skipIf(process.platform !== "darwin")(
    "says to boot a simulator when none is booted, without building",
    async () => {
      const calls = await fakeXcode({ installed: true, booted: JSON.stringify({ devices: {} }) });
      const root = await tempDir();
      const result = await shell.run(
        context({ root, projectDir: path.join(root, ".farm", "output", "mobile", "ios") }),
      );
      expect(result.launched).toBe(false);
      expect(result.message).toContain("No iOS simulator is booted.");
      expect((await calls()).some((call) => call.endsWith(" build"))).toBe(false);
    },
    30_000,
  );

  it.skipIf(process.platform !== "darwin")(
    "builds for the booted simulator, installs, and launches the bundle ID",
    async () => {
      const calls = await fakeXcode({ installed: true, booted: BOOTED });
      expect(await listBootedSimulators()).toEqual([{ udid: "UDID-1", name: "iPhone 16" }]);
      const projectDir = await tempDir();
      const result = await shell.run(context({ root: projectDir, projectDir }));
      expect(result).toEqual({ launched: true, message: `Opened Farm "Notes" & Co on iPhone 16.` });
      const app = path.join(projectDir, "build/Build/Products/Debug-iphonesimulator/App.app");
      expect(
        (await calls()).filter((call) => !call.includes("-version") && !call.includes("--find")),
      ).toEqual([
        "xcrun simctl list devices booted --json",
        "xcrun simctl list devices booted --json",
        "xcodebuild -project App.xcodeproj -scheme App -configuration Debug -destination id=UDID-1 -derivedDataPath build -quiet build",
        `xcrun simctl install UDID-1 ${app}`,
        "xcrun simctl launch UDID-1 com.example.notes",
      ]);

      const distDir = path.join(projectDir, "dist");
      const packaged = await shell.package({
        ...context({ root: projectDir, projectDir }),
        distDir,
      });
      expect(packaged.files).toEqual([path.join(distDir, "com.example.notes-simulator.app")]);
      expect(await readFile(path.join(packaged.files[0]!, "App"), "utf8")).toBe("app\n");
    },
    30_000,
  );
});
