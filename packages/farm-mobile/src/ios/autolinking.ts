import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MobileGeneratedFile, MobileShellContext } from "@farm.js/core/mobile";
import { findPackage, readPackageConfig } from "../android/autolinking.js";

/**
 * Native modules on iOS React Native screens (RFC 0004, 7.5), without CocoaPods. The same
 * packages the Android project links: the app's own `dependencies` with native code, and the
 * app's TurboModules in `src/native/`. Each package's iOS sources (its podspec's
 * `source_files`) are copied into `FarmModules/` and compiled into the app; React Native's
 * Codegen writes their spec glue and the app's dependency provider next to them.
 *
 * Swift sources compile into the same module, the FarmReactNativeHost framework, so a package's
 * Objective-C reaches them through the framework's generated
 * `<FarmReactNativeHost/FarmReactNativeHost-Swift.h>`.
 * CocoaPods would generate `<Module>-Swift.h` for the pod instead; `FarmModules/FarmSwiftHeaders/`
 * holds that name for each package with Swift, forwarding to the framework's header.
 */

/** Linked sources and Codegen output in the generated project, a sibling of `App/`. */
export const IOS_MODULES_DIR = "FarmModules";
/** Codegen's library name for the app's own specs, as on Android. */
export const IOS_APP_MODULES_LIBRARY = "FarmAppSpec";
/** `<Module>-Swift.h` for each linked package with Swift sources, under `FarmModules/`. */
export const IOS_SWIFT_HEADERS_DIR = "FarmSwiftHeaders";

export interface IosAutolinking {
  /** Linked package names, sorted; the app's own modules are `"app"`. */
  modules: string[];
  /** Files under `FarmModules/`. */
  files: MobileGeneratedFile[];
  /** System frameworks the linked packages name in their podspecs, sorted. */
  frameworks: string[];
}

function mobileError(message: string): Error {
  return Object.assign(new Error(message), { name: "FarmMobileError" });
}

/** A CocoaPods glob (`ios/**\/*.{h,m,mm}`) as a regular expression over `/` paths. */
export function podGlob(pattern: string): RegExp {
  let out = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      index++;
      if (pattern[index + 1] === "/") {
        index++;
        out += "(?:.*/)?";
      } else {
        out += ".*";
      }
    } else if (character === "*") out += "[^/]*";
    else if (character === "?") out += "[^/]";
    else if (character === "{") out += "(?:";
    else if (character === "}") out += ")";
    else if (character === ",") out += "|";
    else out += character.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** The string values of `<spec>.<key> = ...` in a podspec: a string, an array, or `%w[...]`. */
export function podspecList(podspec: string, key: string): string[] {
  const assignment = new RegExp(`\\.${key}\\s*=\\s*`, "g");
  const values: string[] = [];
  for (const match of podspec.matchAll(assignment)) {
    const rest = podspec.slice(match.index! + match[0].length);
    const words = /^%w[[({]([^\])}]*)[\])}]/.exec(rest);
    if (words) {
      values.push(...words[1]!.split(/\s+/).filter(Boolean));
      continue;
    }
    const list = /^\[([^\]]*)\]/.exec(rest);
    const source = list ? list[1]! : (/^(["'][^"'\n]*["'])/.exec(rest)?.[1] ?? "");
    values.push(...[...source.matchAll(/["']([^"']*)["']/g)].map((value) => value[1]!));
  }
  return values;
}

/** Files under `dir`, relative; `skipTop` names top-level folders a package keeps other code in. */
async function walk(dir: string, prefix = "", skipTop: readonly string[] = []): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (/\.(xcodeproj|xcworkspace)$/.test(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!prefix && skipTop.includes(entry.name)) continue;
      files.push(...(await walk(path.join(dir, entry.name), relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

const SOURCE = /\.(h|hpp|m|mm|c|cpp|swift)$/;

interface LinkedPackage {
  name: string;
  root: string;
  /** Paths relative to `root`. */
  files: string[];
  frameworks: string[];
  /** With Swift sources: the module name CocoaPods would give the pod, for `<Module>-Swift.h`. */
  swiftModule?: string;
}

/**
 * The module CocoaPods builds a pod as: `module_name`, else the spec's `name` with every
 * character that is not a letter, digit or underscore replaced, as CocoaPods does. A computed
 * name (`s.name = package["name"]`) falls back to the podspec's file name, which CocoaPods
 * requires to match it.
 */
export function podModuleName(podspec: string, podspecFile: string): string {
  const literal = (key: string) =>
    new RegExp(`\\.${key}\\s*=\\s*["']([^"'\\n]+)["']`).exec(podspec)?.[1];
  const name = literal("module_name") ?? literal("name") ?? path.basename(podspecFile, ".podspec");
  return name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
}

/**
 * `<Module>-Swift.h` for each linked package with Swift, as `#import "RNFoo-Swift.h"` and
 * `#import <RNFoo/RNFoo-Swift.h>` in its Objective-C find it: the package's Swift is part of
 * the FarmReactNativeHost framework, so both forward to the framework's generated header.
 */
export function createSwiftHeaderFiles(modules: readonly string[]): MobileGeneratedFile[] {
  return [...new Set(modules)].sort().flatMap((module) => {
    const contents =
      `// Generated by @farm.js/mobile/ios: ${module}'s Swift is compiled into the\n` +
      "// FarmReactNativeHost framework, so the header CocoaPods would generate for the pod is the\n" +
      "// framework's own. Do not edit. That header imports the frameworks its declarations use only\n" +
      "// with Clang modules, which Objective-C++ compiles without: import React's first.\n" +
      "#import <UIKit/UIKit.h>\n" +
      "#import <React/RCTBridgeModule.h>\n" +
      "#import <FarmReactNativeHost/FarmReactNativeHost-Swift.h>\n";
    return [
      { path: `${IOS_MODULES_DIR}/${IOS_SWIFT_HEADERS_DIR}/${module}-Swift.h`, contents },
      { path: `${IOS_MODULES_DIR}/${IOS_SWIFT_HEADERS_DIR}/${module}/${module}-Swift.h`, contents },
    ];
  });
}

/** A package's iOS sources from its podspec, or undefined when it has no iOS code. */
async function linkPackage(name: string, root: string): Promise<LinkedPackage | undefined> {
  const config = await readPackageConfig(name, root, "ios");
  // `ios: null` in react-native.config.js: nothing to link on iOS.
  if (config === null) return undefined;
  const podspecs = (await readdir(root)).filter((file) => file.endsWith(".podspec")).sort();
  const podspecFile = config?.podspecPath
    ? path.resolve(root, config.podspecPath)
    : podspecs[0] && path.join(root, podspecs[0]);
  if (!podspecFile || !existsSync(podspecFile)) return undefined;
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (!pkg.codegenConfig) {
    throw mobileError(
      `"${name}" has iOS code but no "codegenConfig" in its package.json, so it does not ` +
        "support React Native's new architecture, which native screens run on. Upgrade it to a " +
        "version with new architecture support, or remove it from dependencies in package.json.",
    );
  }
  const podspec = await readFile(podspecFile, "utf8");
  const include = podspecList(podspec, "source_files").map(podGlob);
  const exclude = podspecList(podspec, "exclude_files").map(podGlob);
  if (include.length === 0) {
    throw mobileError(
      `Farm cannot read the source_files of "${name}"'s podspec ${path.basename(podspecFile)}.`,
    );
  }
  const files = (await walk(root, "", ["android", "example", "lib", "web", "windows"]))
    .filter((file) => include.some((glob) => glob.test(file)))
    .filter((file) => !exclude.some((glob) => glob.test(file)))
    .sort();
  const sources = files.filter((file) => SOURCE.test(file));
  return {
    name,
    root,
    files: sources,
    ...(sources.some((file) => file.endsWith(".swift"))
      ? { swiftModule: podModuleName(podspec, podspecFile) }
      : {}),
    frameworks: [
      ...podspecList(podspec, "frameworks"),
      ...podspecList(podspec, "framework"),
      ...podspecList(podspec, "weak_frameworks"),
    ],
  };
}

function node(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(mobileError(`React Native's codegen failed (exit ${code}):\n${output.trim()}`)),
    );
  });
}

async function readTree(dir: string, prefix: string, skip: RegExp): Promise<MobileGeneratedFile[]> {
  if (!existsSync(dir)) return [];
  const files: MobileGeneratedFile[] = [];
  for (const relative of await walk(dir)) {
    if (skip.test(relative)) continue;
    files.push({
      path: `${prefix}/${relative}`,
      contents: await readFile(path.join(dir, relative), "utf8"),
    });
  }
  return files;
}

/** The package name as a folder: `@react-native-community/netinfo` -> `react-native-community-netinfo`. */
function folder(name: string): string {
  return name.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "-");
}

/**
 * What an iOS project with React Native screens links. Undefined when the app has no package
 * with iOS code and no `src/native/` modules: the host then uses an empty dependency provider and
 * the project has no `FarmModules/`.
 */
export async function resolveIosAutolinking(
  context: MobileShellContext,
): Promise<IosAutolinking | undefined> {
  if (!context.native) return undefined;
  const app = JSON.parse(await readFile(path.join(context.root, "package.json"), "utf8"));
  const names = Object.keys(app?.dependencies ?? {})
    .filter((name) => name !== "react-native")
    .sort();
  const linked: LinkedPackage[] = [];
  for (const name of names) {
    const root = await findPackage(name, context.root);
    if (!root) {
      throw mobileError(
        `"${name}" is in dependencies but not installed. Install the app's dependencies, then run the command again.`,
      );
    }
    const found = await linkPackage(name, root);
    if (found) linked.push(found);
  }
  const appFiles = context.appModules?.ios ?? [];
  const appSpecs = context.appModules?.specs ?? [];
  if (linked.length === 0 && appFiles.length === 0 && appSpecs.length === 0) return undefined;

  const reactNative = await findPackage("react-native", context.root);
  const codegen = reactNative && (await findPackage("@react-native/codegen", reactNative));
  if (!reactNative || !codegen) {
    throw mobileError(
      `Native modules on iOS need React Native's codegen; reinstall react-native ${context.native.reactNativeVersion}.`,
    );
  }
  const files: MobileGeneratedFile[] = [];
  for (const module of linked) {
    for (const file of module.files) {
      files.push({
        path: `${IOS_MODULES_DIR}/${folder(module.name)}/${file}`,
        contents: await readFile(path.join(module.root, file), "utf8"),
      });
    }
  }
  for (const file of appFiles) {
    files.push({
      path: `${IOS_MODULES_DIR}/app/${path.basename(file)}`,
      contents: await readFile(file, "utf8"),
    });
  }
  files.push(
    ...createSwiftHeaderFiles(linked.flatMap((linkedPackage) => linkedPackage.swiftModule ?? [])),
  );

  const temp = await mkdtemp(path.join(os.tmpdir(), "farm-ios-codegen-"));
  try {
    // Spec glue for the linked packages, and the providers RCTAppDependencyProvider answers from.
    await node(
      [
        path.join(reactNative, "scripts", "generate-codegen-artifacts.js"),
        "-p",
        context.root,
        "-o",
        temp,
        "-t",
        "ios",
      ],
      context.root,
    );
    const generated = path.join(temp, "build", "generated", "ios");
    const skip = /(^|\/)(Package\.swift|[^/]*\.podspec)$/;
    files.push(
      ...(await readTree(
        path.join(generated, "ReactCodegen"),
        `${IOS_MODULES_DIR}/ReactCodegen`,
        skip,
      )),
      ...(await readTree(
        path.join(generated, "ReactAppDependencyProvider"),
        `${IOS_MODULES_DIR}/ReactAppDependencyProvider`,
        skip,
      )),
    );
    if (appSpecs.length > 0) {
      // The app's specs, as one library: NativeDeviceSpec and its JSI glue.
      const schema = path.join(temp, "app-schema.json");
      await node(
        [
          path.join(codegen, "lib", "cli", "combine", "combine-js-to-schema-cli.js"),
          schema,
          ...appSpecs.map((spec) => spec.file),
        ],
        context.root,
      );
      const out = path.join(temp, "app-specs");
      await node(
        [
          path.join(reactNative, "scripts", "generate-specs-cli.js"),
          "-p",
          "ios",
          "-s",
          schema,
          "-o",
          out,
          "-n",
          IOS_APP_MODULES_LIBRARY,
          "-t",
          "modules",
        ],
        context.root,
      );
      files.push(...(await readTree(out, `${IOS_MODULES_DIR}/ReactCodegen`, skip)));
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) throw mobileError(`Two linked files are both ${file.path}.`);
    paths.add(file.path);
  }
  return {
    modules: [
      ...linked.map((module) => module.name),
      ...(appFiles.length || appSpecs.length ? ["app"] : []),
    ],
    files: files.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
    frameworks: [...new Set(linked.flatMap((module) => module.frameworks))].sort(),
  };
}
