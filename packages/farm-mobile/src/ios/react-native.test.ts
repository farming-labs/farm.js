import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MobileShellContext } from "@farm.js/core/mobile";
import {
  createSwiftHeaderFiles,
  podGlob,
  podModuleName,
  podspecList,
  resolveIosAutolinking,
} from "./autolinking";
import {
  createIosProject,
  createProjectFile,
  createReactNativeBuild,
  IOS_NATIVE_ASSETS_DIR,
  IOS_NATIVE_BUNDLE,
  reactNativeArtifacts,
  reactNativeCacheDir,
  reactNativeFlavor,
} from "./index";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function app(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-mobile-ios-rn-"));
  roots.push(root);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "app", dependencies: {} }),
  );
  return root;
}

function context(root: string, overrides: Partial<MobileShellContext> = {}): MobileShellContext {
  return {
    root,
    os: "ios",
    command: "build",
    basePath: "",
    projectDir: path.join(root, ".farm/output/mobile/ios"),
    mobile: {
      name: "Kit",
      id: "com.example.kit",
      server: "https://kit.example.com",
      tabs: [{ path: "/", title: "Home", icon: "house" }],
      routes: {},
      native: {
        engine: "react-native",
        auto: "off",
        routes: {},
        islands: [],
        prefetch: "intent",
        budgets: {},
      },
    },
    manifest: {
      version: 1,
      server: "https://kit.example.com",
      tabs: [{ path: "/", title: "Home", icon: "house" }],
      prefetch: "intent",
      rules: [
        {
          route: "/",
          pattern: "^/?$",
          presentation: "tab",
          tab: 0,
          screen: "web",
          source: "default",
        },
        {
          route: "/kit",
          pattern: "^/kit/?$",
          presentation: "push",
          screen: "native",
          source: "file",
          module: "app/kit",
          nativeOnly: true,
        },
        { pattern: "^/", presentation: "push", screen: "web" },
      ],
    },
    ...overrides,
  } as MobileShellContext;
}

const NATIVE = {
  engine: "react-native" as const,
  reactNativeVersion: "0.88.1",
  hermesVersion: "260318099.0.5",
  modules: ["app/kit"],
};

async function files(ctx: MobileShellContext): Promise<Record<string, string>> {
  return Object.fromEntries(
    (await createIosProject(ctx)).map((file) => [
      file.path,
      typeof file.contents === "string" ? file.contents : `<${file.contents.byteLength} bytes>`,
    ]),
  );
}

describe("@farm.js/mobile/ios React Native host", () => {
  it("adds no React Native to an app without React Native screens", async () => {
    const project = await files(context(await app()));
    const pbxproj = project["App.xcodeproj/project.pbxproj"]!;
    expect(
      Object.keys(project).some((file) => /FarmReactNative|farm-native|FarmModules/.test(file)),
    ).toBe(false);
    expect(pbxproj).not.toMatch(
      /xcframework|Embed Frameworks|c\+\+20|BRIDGING_HEADER|HEADER_SEARCH_PATHS|FarmReactNativeHost/,
    );
    // The engine stub: no JS engine ships.
    expect(project["App/NativeEngine.swift"]).toContain(
      "func createFarmNativeEngine(config: RouteConfig) -> FarmNativeEngine? {\n    nil\n}",
    );
  });

  it("links React Native's XCFrameworks and bundles the Hermes bytecode, the same every time", async () => {
    const root = await app();
    const bundle = path.join(root, "ios.hbc");
    await writeFile(bundle, new Uint8Array([0xc6, 0x1f, 0xbc, 0x03]));
    const ctx = context(root, { native: { ...NATIVE, bundle } });
    const project = await files(ctx);
    expect(project[IOS_NATIVE_BUNDLE]).toBe("<4 bytes>");
    for (const file of [
      "App/FarmReactNative.h",
      "FarmReactNativeHost/FarmReactNative.mm",
      "App/FarmReactNative-Bridging-Header.h",
      "App/FarmReactNativeBuild.swift",
    ]) {
      expect(project[file], file).toBeDefined();
    }
    // The React Native engine replaces the stub.
    expect(project["App/NativeEngine.swift"]).toContain(
      "final class ReactNativeEngine: FarmNativeEngine",
    );
    // Swift reaches React Native only through the plain Objective-C header.
    for (const [file, source] of Object.entries(project).filter(([file]) =>
      file.endsWith(".swift"),
    )) {
      expect(source, file).not.toMatch(/^import React/m);
    }
    expect(project["App/FarmReactNative-Bridging-Header.h"]).toContain(
      '#import "FarmReactNative.h"',
    );
    expect(project["App/FarmReactNative.h"]).not.toContain("<React");

    const pbxproj = project["App.xcodeproj/project.pbxproj"]!;
    for (const framework of ["React", "ReactNativeDependencies", "hermesvm"]) {
      expect(pbxproj).toContain(`/* ${framework}.xcframework in Frameworks */`);
      expect(pbxproj).toContain(`/* ${framework}.xcframework in Embed Frameworks */`);
    }
    expect(pbxproj).toContain("dstSubfolderSpec = 10;");
    expect(pbxproj).toMatch(/ATTRIBUTES = \(\s+CodeSignOnCopy,\s+RemoveHeadersOnCopy,\s+\);/);
    expect(pbxproj).toContain("path = ReactNative;");
    expect(pbxproj).toContain(
      'SWIFT_OBJC_BRIDGING_HEADER = "App/FarmReactNative-Bridging-Header.h";',
    );
    expect(pbxproj).toContain('"$(SRCROOT)/ReactNative/Headers"');
    expect(pbxproj).toContain(
      '"$(SRCROOT)/ReactNative/ReactNativeDependencies.xcframework/Headers"',
    );
    // A build links release React Native, so its headers must not see RCT_DEV from DEBUG=1.
    expect(pbxproj).toContain('"RCT_DEV=0"');
    expect(pbxproj).toContain('"FOLLY_MOBILE=1"');
    expect(pbxproj).toContain("FarmReactNative.mm in Sources");

    // React Native loads lazily: the host framework links it, the app embeds both and links neither.
    const objects = (isa: string) =>
      [
        ...pbxproj.matchAll(
          new RegExp(`\\w+ /\\* [^*]+ \\*/ = \\{\\s+isa = ${isa};[\\s\\S]*?\\n\\t\\t\\};`, "g"),
        ),
      ].map((match) => match[0]);
    const [appTarget, hostTarget] = ["App", "FarmReactNativeHost"].map(
      (name) => objects("PBXNativeTarget").find((target) => target.includes(`name = ${name};`))!,
    );
    expect(hostTarget).toContain('productType = "com.apple.product-type.framework";');
    expect(appTarget).toMatch(/dependencies = \(\s+\w+ \/\* PBXTargetDependency \*\/,\s+\);/);
    const linked = objects("PBXFrameworksBuildPhase");
    // The app's Frameworks phase is empty; the host's links the three XCFrameworks.
    expect(linked.filter((phase) => /files = \(\s+\);/.test(phase))).toHaveLength(1);
    expect(linked.find((phase) => phase.includes("React.xcframework in Frameworks"))).toBeDefined();
    expect(pbxproj).toContain("/* FarmReactNativeHost.framework in Embed Frameworks */");
    // The host's settings carry React Native's; the app keeps only the bridging header.
    expect(pbxproj).toContain('"$(SRCROOT)/App"');
    expect(pbxproj).toContain("SKIP_INSTALL = YES;");
    // Swift never names the host's class, which would link it: it loads the framework and looks
    // the class up by name.
    const engine = project["App/NativeEngine.swift"]!;
    expect(engine).toContain("NSClassFromString(FarmReactNativeRuntimeClass)");
    expect(engine).toContain("loadAndReturnError()");
    expect(engine).not.toMatch(/\bFarmReactNative\(/);
    expect(pbxproj).toContain("farm-native.hbc in Resources");
    // No linked module: the empty dependency provider, no FarmModules.
    expect(pbxproj).not.toContain("FARM_LINKED_MODULES");

    expect((await files(ctx))["App.xcodeproj/project.pbxproj"]).toBe(pbxproj);
    expect(project["App/FarmReactNativeBuild.swift"]).toContain(
      'static let bundleURL: URL? = Bundle.main.url(forResource: "farm-native", withExtension: "hbc")',
    );
  });

  it("ships the images the screens import in assets/ next to the bytecode, as a folder", async () => {
    const root = await app();
    const bundle = path.join(root, "ios.hbc");
    await writeFile(bundle, new Uint8Array([0xc6, 0x1f, 0xbc, 0x03]));
    // Metro's iOS layout: assets/<the image's directory>/<name>@<scale>x.png.
    const assetsDir = path.join(root, "ios-assets");
    const dir = path.join(assetsDir, "assets", "src", "app", "(styled)", "map");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "blaze@3x.png"), new Uint8Array([3]));
    await writeFile(path.join(dir, "blaze@2x.png"), new Uint8Array([2]));
    const project = await files(context(root, { native: { ...NATIVE, bundle, assetsDir } }));
    expect(
      Object.keys(project).filter((file) => file.startsWith(`App/${IOS_NATIVE_ASSETS_DIR}/`)),
    ).toEqual([
      "App/assets/src/app/(styled)/map/blaze@2x.png",
      "App/assets/src/app/(styled)/map/blaze@3x.png",
    ]);
    const pbxproj = project["App.xcodeproj/project.pbxproj"]!;
    // One folder reference, so the app keeps the paths React Native asks for.
    expect(pbxproj).toContain("/* assets in Resources */");
    expect(pbxproj).toMatch(/lastKnownFileType = folder;\s+path = assets;/);
    expect(pbxproj).not.toContain("blaze");
    expect(
      (await files(context(root, { native: { ...NATIVE, bundle } })))[
        "App.xcodeproj/project.pbxproj"
      ],
    ).not.toContain("/* assets in Resources */");

    // Anything outside assets/ is not where React Native looks on iOS.
    await writeFile(path.join(assetsDir, "stray.png"), new Uint8Array([1]));
    await expect(
      createIosProject(context(root, { native: { ...NATIVE, bundle, assetsDir } })),
    ).rejects.toThrow(/Metro wrote App\/stray\.png outside assets\//);
  });

  it("loads screens from Metro under farm dev, on the dev server's host", async () => {
    const root = await app();
    const ctx = context(root, {
      command: "dev",
      native: {
        ...NATIVE,
        devServer: { port: 8082, mainModule: ".farm/output/mobile/native/index" },
      },
    });
    ctx.manifest = { ...ctx.manifest, server: "http://localhost:3001" };
    expect(createReactNativeBuild(ctx)).toContain(
      'URL(string: "http://localhost:8082/.farm/output/mobile/native/index.bundle?platform=ios&dev=true&minify=false&app=com.example.kit")',
    );
    const project = await files(ctx);
    expect(project[IOS_NATIVE_BUNDLE]).toBeUndefined();
    expect(project["App.xcodeproj/project.pbxproj"]).toContain('"RCT_DEV=1"');
    expect(reactNativeFlavor(ctx)).toBe("debug");
    expect(reactNativeFlavor({ command: "build" })).toBe("release");
  });

  it("downloads the three artifacts of the app's React Native and Hermes from Maven", () => {
    expect(reactNativeArtifacts(NATIVE, "release").map((artifact) => artifact.url)).toEqual([
      "https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/0.88.1/react-native-artifacts-0.88.1-reactnative-core-release.tar.gz",
      "https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/0.88.1/react-native-artifacts-0.88.1-reactnative-dependencies-release.tar.gz",
      "https://repo1.maven.org/maven2/com/facebook/hermes/hermes-ios/260318099.0.5/hermes-ios-260318099.0.5-hermes-ios-release.tar.gz",
    ]);
    expect(reactNativeCacheDir({ FARM_REACT_NATIVE_CACHE: "/cache/rn" })).toBe(
      path.resolve("/cache/rn"),
    );
  });

  it("reads a podspec's source files and frameworks", () => {
    const glob = podGlob("ios/**/*.{h,m,mm}");
    expect(["ios/A.h", "ios/x/B.mm", "ios/C.m"].every((file) => glob.test(file))).toBe(true);
    expect(["ios/A.swift", "android/A.m", "iosx/A.m"].some((file) => glob.test(file))).toBe(false);
    expect(podGlob("cpp/*.cpp").test("cpp/a/b.cpp")).toBe(false);
    const podspec = `Pod::Spec.new do |s|
  s.source_files  = "ios/**/*.{h,m,mm,swift}"
  s.exclude_files = ["ios/Tests/**", 'ios/Legacy.m']
  s.frameworks = 'NetworkExtension'
  s.weak_frameworks = %w[CoreTelephony SystemConfiguration]
end`;
    expect(podspecList(podspec, "source_files")).toEqual(["ios/**/*.{h,m,mm,swift}"]);
    expect(podspecList(podspec, "exclude_files")).toEqual(["ios/Tests/**", "ios/Legacy.m"]);
    expect(podspecList(podspec, "frameworks")).toEqual(["NetworkExtension"]);
    expect(podspecList(podspec, "weak_frameworks")).toEqual([
      "CoreTelephony",
      "SystemConfiguration",
    ]);
  });

  it("names a Swift pod's module as CocoaPods does, and forwards its -Swift.h to the host's", () => {
    expect(podModuleName('s.name = "RNStoreReview"', "/p/RNStoreReview.podspec")).toBe(
      "RNStoreReview",
    );
    expect(podModuleName("s.name = 'react-native-foo'", "/p/x.podspec")).toBe("react_native_foo");
    expect(
      podModuleName('s.name = "react-native-foo"\n  s.module_name = "RNFoo"', "/p/x.podspec"),
    ).toBe("RNFoo");
    // A computed name: the podspec's file name, which CocoaPods requires to match.
    expect(podModuleName('s.name = package["name"]', "/p/RNBar.podspec")).toBe("RNBar");

    const headers = createSwiftHeaderFiles(["RNFoo", "RNBar", "RNFoo"]);
    expect(headers.map((file) => file.path)).toEqual([
      "FarmModules/FarmSwiftHeaders/RNBar-Swift.h",
      "FarmModules/FarmSwiftHeaders/RNBar/RNBar-Swift.h",
      "FarmModules/FarmSwiftHeaders/RNFoo-Swift.h",
      "FarmModules/FarmSwiftHeaders/RNFoo/RNFoo-Swift.h",
    ]);
    // The package's Swift is part of the FarmReactNativeHost framework, whose generated header
    // needs React's declarations first, as Objective-C++ does not @import them.
    expect(String(headers[0]!.contents)).toMatch(
      /#import <React\/RCTBridgeModule\.h>\n#import "FarmReactNativeHost-Swift\.h"\n$/,
    );
  });

  it("compiles a package's Swift into the app and searches its -Swift.h shims", async () => {
    const ctx = context(await app(), { native: NATIVE });
    const files = [
      "App/AppDelegate.swift",
      "FarmModules/farm-swift-sample/ios/FarmSwiftSample.mm",
      "FarmModules/farm-swift-sample/ios/FarmSwiftSampleClock.swift",
      "FarmModules/FarmSwiftHeaders/FarmSwiftSample-Swift.h",
      "FarmModules/FarmSwiftHeaders/FarmSwiftSample/FarmSwiftSample-Swift.h",
    ];
    const pbxproj = createProjectFile(ctx, files, { frameworks: [] });
    expect(pbxproj).toContain("FarmSwiftSampleClock.swift in Sources");
    expect(pbxproj).toContain('"$(SRCROOT)/FarmModules/FarmSwiftHeaders"');
    // Without a Swift package, the project is as before.
    expect(createProjectFile(ctx, files.slice(0, 2), { frameworks: [] })).not.toContain(
      "FarmSwiftHeaders",
    );
  });

  it("links only packages with iOS code, and refuses one without codegenConfig", async () => {
    const root = await app();
    const install = async (name: string, files: Record<string, string>) => {
      for (const [file, contents] of Object.entries(files)) {
        const target = path.join(root, "node_modules", name, file);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents);
      }
    };
    await install("old-module", {
      "package.json": JSON.stringify({ name: "old-module" }),
      "old-module.podspec": 's.source_files = "ios/**/*.{h,m}"',
      "ios/Old.m": "",
    });
    await install("android-only", {
      "package.json": JSON.stringify({ name: "android-only", codegenConfig: { name: "A" } }),
      "old.podspec": 's.source_files = "ios/*.m"',
      "react-native.config.js": "module.exports = { dependency: { platforms: { ios: null } } };",
    });
    await install("plain-js", { "package.json": JSON.stringify({ name: "plain-js" }) });
    const write = (dependencies: Record<string, string>) =>
      writeFile(path.join(root, "package.json"), JSON.stringify({ name: "app", dependencies }));
    const ctx = context(root, { native: NATIVE });

    // A package with no podspec, or one that opts out of iOS, links nothing: no FarmModules.
    await write({ "plain-js": "1.0.0", "android-only": "1.0.0" });
    await expect(resolveIosAutolinking(ctx)).resolves.toBeUndefined();
    // Without React Native screens nothing is resolved at all.
    await write({ "old-module": "1.0.0" });
    await expect(resolveIosAutolinking(context(root))).resolves.toBeUndefined();
    await expect(resolveIosAutolinking(ctx)).rejects.toThrow(
      /"old-module" has iOS code but no "codegenConfig"/,
    );
    // A package with Swift sources links: here it stops only at React Native's codegen, which
    // this app does not have installed.
    await install("swift-module", {
      "package.json": JSON.stringify({ name: "swift-module", codegenConfig: { name: "S" } }),
      "SwiftModule.podspec": 's.name = "SwiftModule"\ns.source_files = "ios/*.{h,mm,swift}"',
      "ios/SwiftModule.mm": "",
      "ios/Clock.swift": "",
    });
    await write({ "swift-module": "1.0.0" });
    await expect(resolveIosAutolinking(ctx)).rejects.toThrow(/need React Native's codegen/);
  });
});
