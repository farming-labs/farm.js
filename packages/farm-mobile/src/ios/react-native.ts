/**
 * React Native's prebuilt iOS XCFrameworks (RFC 0004, decisions: "The iOS React Native host
 * links prebuilt XCFrameworks"). React Native publishes three to Maven for every release: the
 * core (`React.xcframework` and the headers-only `ReactNativeHeaders.xcframework`), its
 * third-party dependencies (folly, glog, boost, ...), and Hermes. The generated Xcode project links
 * them from `ReactNative/` next to it, a link to a per-user cache, so no CocoaPods, Swift package,
 * or React Native source build is involved and the project files stay byte-identical.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { MobileNativeScreens, MobileShellContext } from "@farm.js/core/mobile";

/** `ReactNative/` in the generated project: what its build settings and file references name. */
export const IOS_REACT_NATIVE_DIR = "ReactNative";

/** The frameworks the app links and embeds, as laid out in `ReactNative/`. */
export const IOS_REACT_NATIVE_FRAMEWORKS = [
  "React.xcframework",
  "ReactNativeDependencies.xcframework",
  "hermesvm.xcframework",
] as const;

/** Header roots in `ReactNative/`: React Native's own namespaces, then folly, glog and boost. */
export const IOS_REACT_NATIVE_HEADERS = ["Headers", "DependencyHeaders"] as const;

/**
 * Debug artifacts (React Native's dev support: Metro, Fast Refresh, the dev menu) for
 * `farm dev --mobile`, release artifacts for `farm build --mobile`.
 */
export type ReactNativeFlavor = "debug" | "release";

export function reactNativeFlavor(context: Pick<MobileShellContext, "command">): ReactNativeFlavor {
  return context.command === "dev" ? "debug" : "release";
}

const MAVEN = "https://repo1.maven.org/maven2";

export interface ReactNativeArtifact {
  name: "core" | "dependencies" | "hermes";
  url: string;
}

/** The three tarballs for one React Native release and flavor on Maven Central. */
export function reactNativeArtifacts(
  native: Pick<MobileNativeScreens, "reactNativeVersion" | "hermesVersion">,
  flavor: ReactNativeFlavor,
  repository = MAVEN,
): ReactNativeArtifact[] {
  const rn = native.reactNativeVersion;
  const hermes = native.hermesVersion;
  const core = `${repository}/com/facebook/react/react-native-artifacts/${rn}/react-native-artifacts-${rn}`;
  return [
    { name: "core", url: `${core}-reactnative-core-${flavor}.tar.gz` },
    { name: "dependencies", url: `${core}-reactnative-dependencies-${flavor}.tar.gz` },
    {
      name: "hermes",
      url: `${repository}/com/facebook/hermes/hermes-ios/${hermes}/hermes-ios-${hermes}-hermes-ios-${flavor}.tar.gz`,
    },
  ];
}

/** `FARM_REACT_NATIVE_CACHE`, or the user's cache directory. */
export function reactNativeCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.FARM_REACT_NATIVE_CACHE) return path.resolve(env.FARM_REACT_NATIVE_CACHE);
  const base =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches")
      : (env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"));
  return path.join(base, "farm.js", "react-native");
}

function mobileError(message: string): Error {
  return Object.assign(new Error(message), { name: "FarmMobileError" });
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args[0]} exited with ${code}.`)),
    );
  });
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/**
 * Download `url` to `file` and check it against the `.sha256` Maven publishes next to it, the
 * check Gradle makes for the Android artifacts from the same repository.
 */
async function download(url: string, file: string): Promise<void> {
  const expected = await fetch(`${url}.sha256`, { redirect: "follow" });
  if (!expected.ok) {
    throw mobileError(`Cannot read ${url}.sha256 (HTTP ${expected.status}).`);
  }
  const digest = (await expected.text()).trim().split(/\s+/)[0]!.toLowerCase();
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw mobileError(`Cannot download ${url} (HTTP ${response.status}).`);
  }
  const partial = `${file}.partial`;
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));
  const actual = await sha256(partial);
  if (actual !== digest) {
    await rm(partial, { force: true });
    throw mobileError(`${url} does not match its checksum (${actual}, expected ${digest}).`);
  }
  await rename(partial, file);
}

/** The first directory named `name` under `dir`, breadth first. */
async function find(dir: string, name: string): Promise<string | undefined> {
  const queue = [dir];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(current, entry.name);
      if (entry.name === name) return child;
      queue.push(child);
    }
  }
  return undefined;
}

async function required(dir: string, name: string, artifact: string): Promise<string> {
  const found = await find(dir, name);
  if (!found) throw mobileError(`${artifact} has no ${name}; is it from another React Native?`);
  return found;
}

/**
 * The cache slot for one React Native and Hermes version and flavor, downloaded and laid out on
 * first use:
 *
 *   React.xcframework, ReactNativeDependencies.xcframework, hermesvm.xcframework
 *   Headers/            ReactNativeHeaders.xcframework's headers (<react/...>, <ReactCommon/...>)
 *   DependencyHeaders/  ReactNativeDependencies' headers (<folly/...>, <glog/...>, ...)
 */
export async function ensureReactNativeArtifacts(
  native: Pick<MobileNativeScreens, "reactNativeVersion" | "hermesVersion">,
  flavor: ReactNativeFlavor,
  options: { cacheDir?: string; log?: (message: string) => void } = {},
): Promise<string> {
  const root = options.cacheDir ?? reactNativeCacheDir();
  const slot = path.join(
    root,
    `${native.reactNativeVersion}-hermes-${native.hermesVersion}`,
    flavor,
  );
  if (existsSync(path.join(slot, ".complete"))) return slot;

  const staging = `${slot}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    for (const artifact of reactNativeArtifacts(native, flavor)) {
      const tarball = path.join(staging, `${artifact.name}.tar.gz`);
      options.log?.(`React Native ${flavor} ${artifact.name}: ${artifact.url}`);
      await download(artifact.url, tarball);
      const out = path.join(staging, artifact.name);
      await mkdir(out, { recursive: true });
      await run("tar", ["-xzf", tarball, "-C", out]);
      await rm(tarball, { force: true });
    }
    const layout = path.join(staging, "layout");
    await mkdir(layout, { recursive: true });
    const core = path.join(staging, "core");
    await rename(
      await required(core, "React.xcframework", "The core tarball"),
      path.join(layout, "React.xcframework"),
    );
    // Every slice of the headers-only framework has the same headers.
    const headersFramework = await required(
      core,
      "ReactNativeHeaders.xcframework",
      "The core tarball",
    );
    await rename(
      await required(headersFramework, "Headers", "ReactNativeHeaders.xcframework"),
      path.join(layout, "Headers"),
    );
    const deps = await required(
      path.join(staging, "dependencies"),
      "ReactNativeDependencies.xcframework",
      "The dependencies tarball",
    );
    // The headers sit beside the slices; Xcode expects only slices and Info.plist there.
    await rename(path.join(deps, "Headers"), path.join(layout, "DependencyHeaders"));
    await rename(deps, path.join(layout, "ReactNativeDependencies.xcframework"));
    await rename(
      await required(path.join(staging, "hermes"), "hermesvm.xcframework", "The Hermes tarball"),
      path.join(layout, "hermesvm.xcframework"),
    );
    await writeFile(
      path.join(layout, ".complete"),
      `${JSON.stringify({ ...native, flavor }, null, 2)}\n`,
    );
    await rm(slot, { recursive: true, force: true });
    await mkdir(path.dirname(slot), { recursive: true });
    await rename(layout, slot);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return slot;
}

/**
 * Point `<projectDir>/ReactNative` at the cache slot for this build. Only apps with React Native
 * screens call this; for the others the project references no framework.
 */
export async function linkReactNativeArtifacts(
  context: MobileShellContext,
  options: { cacheDir?: string; log?: (message: string) => void } = {},
): Promise<string> {
  if (!context.native) throw mobileError("This app has no React Native screens.");
  const slot = await ensureReactNativeArtifacts(
    context.native,
    reactNativeFlavor(context),
    options,
  );
  const link = path.join(context.projectDir, IOS_REACT_NATIVE_DIR);
  const current = await lstat(link).catch(() => undefined);
  if (current?.isSymbolicLink() && (await readlink(link)) === slot) return link;
  if (current) await rm(link, { recursive: true, force: true });
  await mkdir(context.projectDir, { recursive: true });
  try {
    await symlink(slot, link, "dir");
  } catch {
    // A filesystem without links: copy (APFS clones it).
    await cp(slot, link, { recursive: true, verbatimSymlinks: true });
  }
  return link;
}
