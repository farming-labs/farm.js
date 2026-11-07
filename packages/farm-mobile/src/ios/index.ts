import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  defineMobileShell,
  type MobilePackageContext,
  type MobileShellContext,
} from "@farm.js/core/mobile";
import { linkReactNativeArtifacts } from "./react-native.js";
import { createIosProject, IOS_PROJECT, IOS_TARGET } from "./templates.js";

export {
  createAppIcon,
  createFarmBuild,
  createInfoPlist,
  createIosProject,
  createProjectFile,
  createReactNativeBuild,
  createReactNativeBuildSettings,
  createScheme,
  createTransportSecurity,
  IOS_DEPLOYMENT_TARGET,
  IOS_NATIVE_BUNDLE,
  IOS_NATIVE_ASSETS_DIR,
  IOS_PAGE_SHELLS_DIR,
  IOS_PROJECT,
  IOS_TARGET,
  resolveTabSymbol,
  swiftString,
} from "./templates.js";
export {
  ensureReactNativeArtifacts,
  IOS_REACT_NATIVE_DIR,
  IOS_REACT_NATIVE_FRAMEWORKS,
  linkReactNativeArtifacts,
  reactNativeArtifacts,
  reactNativeCacheDir,
  reactNativeFlavor,
} from "./react-native.js";

/** Derived data inside the generated project, so rebuilds are incremental across runs. */
const DERIVED_DATA = "build";
const SIMULATOR_APP = `${DERIVED_DATA}/Build/Products/Debug-iphonesimulator/${IOS_TARGET}.app`;

function exec(
  command: string,
  args: string[],
  options: { cwd?: string; capture?: boolean } = {},
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), stdout }));
  });
}

async function succeeds(command: string, args: string[]): Promise<boolean> {
  try {
    return (await exec(command, args, { capture: true })).code === 0;
  } catch {
    return false;
  }
}

/**
 * Xcode with the iOS platform: `xcodebuild` and `simctl` both answer. The Command Line Tools
 * alone ship stubs of both that fail.
 */
export async function hasXcode(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  return (
    (await succeeds("xcodebuild", ["-version"])) && (await succeeds("xcrun", ["--find", "simctl"]))
  );
}

export interface IosSimulator {
  udid: string;
  name: string;
}

/** Booted iOS simulators, from `xcrun simctl list devices booted --json`. Empty when none. */
export async function listBootedSimulators(): Promise<IosSimulator[]> {
  try {
    const { code, stdout } = await exec(
      "xcrun",
      ["simctl", "list", "devices", "booted", "--json"],
      { capture: true },
    );
    if (code !== 0) return [];
    const { devices } = JSON.parse(stdout) as {
      devices?: Record<string, Array<{ udid?: string; name?: string; state?: string }>>;
    };
    return Object.entries(devices ?? {})
      .filter(([runtime]) => /SimRuntime\.iOS/i.test(runtime))
      .flatMap(([, list]) => list)
      .filter((device) => device.state === "Booted" && device.udid)
      .map((device) => ({ udid: device.udid!, name: device.name ?? device.udid! }));
  } catch {
    return [];
  }
}

function shown(context: MobileShellContext, file: string): string {
  return path.relative(context.root, file).split(path.sep).join("/") || ".";
}

function xcodebuildArgs(destination: string): string[] {
  return [
    "-project",
    IOS_PROJECT,
    "-scheme",
    IOS_TARGET,
    "-configuration",
    "Debug",
    "-destination",
    destination,
    "-derivedDataPath",
    DERIVED_DATA,
    "-quiet",
    "build",
  ];
}

/** The commands that build, install, and open the debug app on a booted simulator. */
function runInstructions(context: MobileShellContext): string {
  return [
    "Boot a simulator (open -a Simulator), then:",
    `  cd ${shown(context, context.projectDir)} && xcodebuild ${xcodebuildArgs(
      "generic/platform=iOS Simulator",
    )
      .map((arg) => (arg.includes(" ") ? `'${arg}'` : arg))
      .join(" ")}`,
    `  xcrun simctl install booted ${SIMULATOR_APP}`,
    `  xcrun simctl launch booted ${context.mobile.id}`,
  ].join("\n");
}

/** What to install when this machine cannot build iOS apps, then how to run the app. */
function setupInstructions(context: MobileShellContext): string {
  if (process.platform !== "darwin") {
    return (
      `iOS apps build only on macOS with Xcode. Copy ${shown(context, context.projectDir)} to a Mac ` +
      `with Xcode and the iOS 16 or newer SDK and run:\n${runInstructions(context)}`
    );
  }
  return [
    "Xcode was not found (the Command Line Tools alone cannot build iOS apps), so the app was not built.",
    "Install Xcode with the iOS 16 or newer SDK from the App Store, then:",
    "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer",
    "  xcodebuild -runFirstLaunch",
    "  xcodebuild -downloadPlatform iOS",
    runInstructions(context),
  ].join("\n");
}

async function xcodebuild(context: MobileShellContext, destination: string): Promise<string> {
  // React Native screens link React Native's prebuilt XCFrameworks from ReactNative/.
  if (context.native) {
    await linkReactNativeArtifacts(context, { log: (message) => console.log(message) });
  }
  const { code } = await exec("xcodebuild", xcodebuildArgs(destination), {
    cwd: context.projectDir,
  });
  if (code !== 0) throw new Error(`xcodebuild exited with code ${code}.`);
  return path.join(context.projectDir, SIMULATOR_APP);
}

async function simctl(args: string[]): Promise<void> {
  const { code } = await exec("xcrun", ["simctl", ...args]);
  if (code !== 0) throw new Error(`xcrun simctl ${args[0]} exited with code ${code}.`);
}

export default defineMobileShell({
  os: "ios",

  generate(context) {
    return createIosProject(context);
  },

  async run(context) {
    if (!(await hasXcode())) {
      return { launched: false, message: setupInstructions(context) };
    }
    const simulators = await listBootedSimulators();
    if (simulators.length === 0) {
      return {
        launched: false,
        message: [
          "No iOS simulator is booted. List them with xcrun simctl list devices available, boot one",
          'with xcrun simctl boot "<name>" (or open -a Simulator), and run this again. Or:',
          runInstructions(context),
        ].join("\n"),
      };
    }
    const simulator = simulators[0]!;
    const app = await xcodebuild(context, `id=${simulator.udid}`);
    await simctl(["install", simulator.udid, app]);
    await simctl(["launch", simulator.udid, context.mobile.id]);
    return { launched: true, message: `Opened ${context.mobile.name} on ${simulator.name}.` };
  },

  async package(context: MobilePackageContext) {
    if (!(await hasXcode())) return { files: [], message: setupInstructions(context) };
    const app = await xcodebuild(context, "generic/platform=iOS Simulator");
    await mkdir(context.distDir, { recursive: true });
    const file = path.join(context.distDir, `${context.mobile.id}-simulator.app`);
    await rm(file, { recursive: true, force: true });
    await cp(app, file, { recursive: true, verbatimSymlinks: true });
    return {
      files: [file],
      message: `Install it on a booted simulator: xcrun simctl install booted ${shown(context, file)}`,
    };
  },
});
