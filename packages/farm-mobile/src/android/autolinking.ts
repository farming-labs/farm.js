import { existsSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MobileGeneratedFile, MobileShellContext } from "@farm.js/core/mobile";
import { resolveAndroidAppModules } from "./app-modules.js";

/**
 * Community React Native modules on native screens (RFC 0004, 7.5). Farm writes the
 * `autolinking.json` React Native's Gradle plugin reads, from the app's own `dependencies` only:
 * the packages Metro bundles for the screens, without `@react-native-community/cli`. The app's
 * own modules in `src/native/` are one more entry (app-modules.ts).
 */

/** One linked package, in the shape React Native's Gradle plugin reads from `autolinking.json`. */
export interface AndroidNativeModule {
  name: string;
  /** The installed package directory, symlinks resolved. Paths use forward slashes. */
  root: string;
  android: {
    sourceDir: string;
    packageImportPath: string;
    packageInstance: string;
    buildTypes: string[];
    libraryName: string | null;
    componentDescriptors: string[];
    cmakeListsPath: string | null;
    cxxModuleCMakeListsModuleName: string | null;
    cxxModuleCMakeListsPath: string | null;
    cxxModuleHeaderName: string | null;
    dependencyConfiguration: string | null;
    isPureCxxDependency: boolean;
  };
}

/** What a project that links native modules needs from the app's install. */
export interface AndroidAutolinking {
  modules: AndroidNativeModule[];
  /** The app root, symlinks resolved. */
  root: string;
  reactNativeDir: string;
  gradlePluginDir: string;
  codegenDir: string;
  /** The library for the app's own modules in `src/native/`, when it has specs. */
  appModuleFiles?: MobileGeneratedFile[];
}

function mobileError(message: string): Error {
  return Object.assign(new Error(message), { name: "FarmMobileError" });
}

/** Gradle, CMake, and JSON take forward slashes on every OS. */
function slash(file: string): string {
  return file.split(path.sep).join("/");
}

async function readJson(file: string): Promise<Record<string, any> | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** The installed package directory, as Node resolves it from `from`. */
export async function findPackage(name: string, from: string): Promise<string | undefined> {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return realpath(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function sourceFiles(dir: string, extensions: RegExp): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "build" || entry.name.startsWith(".")) {
      continue;
    }
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(file, extensions)));
    else if (extensions.test(entry.name)) files.push(file);
  }
  return files.sort();
}

const PACKAGE_CLASS =
  /class\s+(\w+)[^{]*?(?:\bextends\b|\bimplements\b|:)[^{]*\b(?:BaseReactPackage|TurboReactPackage|ReactPackage)\b/;

/** The `ReactPackage` class under `android/`, as React Native's CLI finds it. */
async function findPackageClass(
  name: string,
  sourceDir: string,
): Promise<{ importPath: string; instance: string }> {
  for (const file of await sourceFiles(path.join(sourceDir, "src"), /\.(java|kt)$/)) {
    const source = await readFile(file, "utf8");
    const match = PACKAGE_CLASS.exec(source);
    const javaPackage = /^\s*package\s+([\w.]+)/m.exec(source)?.[1];
    if (!match || !javaPackage) continue;
    return {
      importPath: `import ${javaPackage}.${match[1]};`,
      instance: `new ${match[1]}()`,
    };
  }
  throw mobileError(
    `"${name}" has Android code but no class that implements ReactPackage under ${slash(sourceDir)}/src. ` +
      "Farm links a module through its ReactPackage. Upgrade the package, or remove it from dependencies in package.json.",
  );
}

const COMPONENT =
  /codegenNativeComponent(<.*>)?\s*\(\s*["'`](\w+)["'`](,?[\s\S]+interfaceOnly:\s*(\w+))?/m;

/** The Fabric components a package declares with `codegenNativeComponent`. */
async function findComponentDescriptors(root: string, jsSrcsDir?: string): Promise<string[]> {
  const descriptors = new Set<string>();
  for (const file of await sourceFiles(path.join(root, jsSrcsDir ?? ""), /\.(js|jsx|ts|tsx)$/)) {
    if (file.endsWith(".d.ts")) continue;
    const match = COMPONENT.exec(await readFile(file, "utf8"));
    if (match && match[4] !== "true") descriptors.add(`${match[2]}ComponentDescriptor`);
  }
  return [...descriptors].sort();
}

/** `dependency.platforms.<os>` from the package's `react-native.config.js`, if it has one. */
export async function readPackageConfig(
  name: string,
  root: string,
  os: "android" | "ios" = "android",
): Promise<Record<string, any> | null | undefined> {
  const file = ["react-native.config.js", "react-native.config.cjs", "react-native.config.mjs"]
    .map((candidate) => path.join(root, candidate))
    .find((candidate) => existsSync(candidate));
  if (!file) return undefined;
  let config: any;
  try {
    const loaded = await import(pathToFileURL(file).href);
    config = loaded.default ?? loaded;
  } catch (error) {
    throw Object.assign(
      mobileError(`Could not load ${slash(path.relative(root, file))} of "${name}".`),
      { cause: error },
    );
  }
  return config?.dependency?.platforms?.[os];
}

async function linkPackage(name: string, root: string): Promise<AndroidNativeModule | undefined> {
  const pkg = (await readJson(path.join(root, "package.json"))) ?? {};
  const config = await readPackageConfig(name, root);
  // `android: null` in react-native.config.js: the package has nothing to link on Android.
  if (config === null) return undefined;
  const sourceDir = config?.sourceDir
    ? path.resolve(root, config.sourceDir)
    : path.join(root, "android");
  const gradle = ["build.gradle", "build.gradle.kts"].some((file) =>
    existsSync(path.join(sourceDir, file)),
  );
  if (!gradle) return undefined;
  const codegen = pkg.codegenConfig;
  if (!codegen) {
    throw mobileError(
      `"${name}" has Android code but no "codegenConfig" in its package.json, so it does not ` +
        "support React Native's new architecture, which native screens run on. Upgrade it to a " +
        "version with new architecture support, or remove it from dependencies in package.json.",
    );
  }
  const found =
    config?.packageImportPath && config?.packageInstance
      ? { importPath: config.packageImportPath, instance: config.packageInstance }
      : await findPackageClass(name, sourceDir);
  const libraryName: string | null = config?.libraryName ?? codegen.name ?? null;
  const componentDescriptors: string[] =
    config?.componentDescriptors ??
    (codegen.type === "modules" ? [] : await findComponentDescriptors(root, codegen.jsSrcsDir));
  const cmakeListsPath: string | null =
    config?.cmakeListsPath !== undefined
      ? config.cmakeListsPath && slash(path.resolve(sourceDir, config.cmakeListsPath))
      : libraryName
        ? `${slash(sourceDir)}/build/generated/source/codegen/jni/CMakeLists.txt`
        : null;
  const optional = (key: string): string | null =>
    typeof config?.[key] === "string" ? config[key] : null;
  return {
    name,
    root: slash(root),
    android: {
      sourceDir: slash(sourceDir),
      packageImportPath: found.importPath,
      packageInstance: found.instance,
      buildTypes: Array.isArray(config?.buildTypes) ? config.buildTypes : [],
      libraryName,
      componentDescriptors,
      cmakeListsPath,
      cxxModuleCMakeListsModuleName: optional("cxxModuleCMakeListsModuleName"),
      cxxModuleCMakeListsPath: config?.cxxModuleCMakeListsPath
        ? slash(path.resolve(sourceDir, config.cxxModuleCMakeListsPath))
        : null,
      cxxModuleHeaderName: optional("cxxModuleHeaderName"),
      dependencyConfiguration: optional("dependencyConfiguration"),
      isPureCxxDependency: false,
    },
  };
}

/**
 * The native modules a project with React Native screens links: the app's `dependencies` that
 * have Android code, and the app's own modules in `src/native/`. `devDependencies` and
 * dependencies of dependencies are never linked, the way Metro bundles only what the screens
 * import. Undefined when there is nothing to link, and then the project is exactly the one
 * without autolinking.
 */
export async function resolveAndroidAutolinking(
  context: MobileShellContext,
): Promise<AndroidAutolinking | undefined> {
  if (!context.native) return undefined;
  const app = await readJson(path.join(context.root, "package.json"));
  const names = Object.keys(app?.dependencies ?? {})
    .filter((name) => name !== "react-native")
    .sort();
  const modules: AndroidNativeModule[] = [];
  for (const name of names) {
    const root = await findPackage(name, context.root);
    if (!root) {
      throw mobileError(
        `"${name}" is in dependencies but not installed. Install the app's dependencies, then run the command again.`,
      );
    }
    const linked = await linkPackage(name, root);
    if (linked) modules.push(linked);
  }
  const appModules = await resolveAndroidAppModules(context);
  if (appModules) modules.push(appModules.module);
  if (modules.length === 0) return undefined;

  const reactNativeDir = await findPackage("react-native", context.root);
  if (!reactNativeDir) {
    throw mobileError(
      "Native modules link through React Native's Gradle plugin, which needs react-native installed in the app.",
    );
  }
  // Dependencies of react-native, so look next to it first (pnpm keeps them there).
  const fromReactNative = async (name: string) =>
    (await findPackage(name, reactNativeDir)) ?? (await findPackage(name, context.root));
  const gradlePluginDir = await fromReactNative("@react-native/gradle-plugin");
  const codegenDir = await fromReactNative("@react-native/codegen");
  if (!gradlePluginDir || !codegenDir) {
    throw mobileError(
      `Native modules link through React Native's Gradle plugin and codegen, but ${
        gradlePluginDir ? "@react-native/codegen" : "@react-native/gradle-plugin"
      } is not installed. Reinstall react-native ${context.native.reactNativeVersion}.`,
    );
  }
  return {
    modules,
    root: slash(await realpath(context.root)),
    reactNativeDir: slash(reactNativeDir),
    gradlePluginDir: slash(gradlePluginDir),
    codegenDir: slash(codegenDir),
    ...(appModules ? { appModuleFiles: appModules.files } : {}),
  };
}

/** `autolinking.json`, the `npx @react-native-community/cli config` shape the plugin reads. */
export function createAutolinkingConfig(
  context: MobileShellContext,
  linking: AndroidAutolinking,
  options: { packageName: string; mainActivity: string },
): string {
  const dependencies = Object.fromEntries(
    linking.modules.map((module) => [
      module.name,
      { root: module.root, name: module.name, platforms: { android: module.android } },
    ]),
  );
  const config = {
    reactNativeVersion: context.native?.reactNativeVersion,
    dependencies,
    project: {
      android: {
        sourceDir: `${slash(context.projectDir)}/app`,
        appName: "app",
        packageName: options.packageName,
        applicationId: context.mobile.id,
        mainActivity: options.mainActivity,
        watchModeCommandParams: null,
        dependencyConfiguration: null,
      },
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}
