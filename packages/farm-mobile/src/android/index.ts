import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defineMobileShell, type MobileShellContext } from "@farm.js/core/mobile";
import { createAndroidProject, MAIN_ACTIVITY } from "./templates.js";

export {
  createAndroidProject,
  createAppBuildGradle,
  createNetworkSecurityConfig,
  createStrings,
  createTabIcons,
  resolveTabIcon,
  MAIN_ACTIVITY,
  SHELL_NAMESPACE,
} from "./templates.js";

const isWindows = process.platform === "win32";

/** An expected failure with its own fix; the CLI prints it without a stack. */
function mobileError(message: string): Error {
  return Object.assign(new Error(message), { name: "FarmMobileError" });
}

/** The Android SDK: ANDROID_HOME, ANDROID_SDK_ROOT, or Android Studio's default location. */
export function resolveAndroidSdk(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = os.homedir();
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    process.platform === "darwin" ? path.join(home, "Library", "Android", "sdk") : undefined,
    isWindows && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Android", "Sdk") : undefined,
    process.platform === "linux" ? path.join(home, "Android", "Sdk") : undefined,
  ];
  return candidates.find((dir): dir is string => !!dir && existsSync(dir));
}

function requireAndroidSdk(): string {
  const sdk = resolveAndroidSdk();
  if (!sdk) {
    throw mobileError(
      "The Android shell needs the Android SDK (platform 35, build-tools 35, platform-tools). " +
        "Install Android Studio or the command-line tools, then set ANDROID_HOME to the SDK directory.",
    );
  }
  return sdk;
}

/** `adb` from the SDK's platform-tools, or from PATH. */
export function resolveAdb(sdk: string | undefined): string {
  const adb = sdk && path.join(sdk, "platform-tools", isWindows ? "adb.exe" : "adb");
  return adb && existsSync(adb) ? adb : "adb";
}

function exec(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean } = {},
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      // gradlew.bat is a batch file, which Node runs only through the shell.
      shell: isWindows && command.endsWith(".bat"),
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), stdout }));
  });
}

/** Serials of the devices and emulators `adb devices` lists as ready. Empty when adb is missing. */
export async function listAndroidDevices(adb: string): Promise<string[]> {
  try {
    const { code, stdout } = await exec(adb, ["devices"], { capture: true });
    if (code !== 0) return [];
    return stdout
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter(([serial, state]) => serial && state === "device")
      .map(([serial]) => serial);
  } catch {
    return [];
  }
}

/** Gradle reads the SDK from local.properties; written next to the generated project only. */
async function writeLocalProperties(projectDir: string, sdk: string): Promise<void> {
  // Backslashes and colons are escapes in .properties files.
  const dir = sdk.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  await writeFile(path.join(projectDir, "local.properties"), `sdk.dir=${dir}\n`);
}

async function gradle(projectDir: string, task: string, env?: NodeJS.ProcessEnv): Promise<void> {
  const wrapper = path.join(projectDir, isWindows ? "gradlew.bat" : "gradlew");
  const { code } = await exec(wrapper, [task], { cwd: projectDir, env });
  if (code !== 0) throw new Error(`./gradlew ${task} exited with code ${code}.`);
}

function shown(context: MobileShellContext, file: string): string {
  return path.relative(context.root, file).split(path.sep).join("/") || ".";
}

/** The commands that install and open the debug app, for when nothing is connected. */
function runInstructions(context: MobileShellContext): string {
  const component = `${context.mobile.id}/${MAIN_ACTIVITY}`;
  return [
    "Start an emulator (emulator -avd <name>) or connect a device, then:",
    `  cd ${shown(context, context.projectDir)} && ./gradlew installDebug`,
    `  adb shell am start -n ${component}`,
  ].join("\n");
}

export default defineMobileShell({
  os: "android",

  generate(context) {
    return createAndroidProject(context);
  },

  async run(context) {
    const sdk = resolveAndroidSdk();
    if (!sdk) {
      return {
        launched: false,
        message: `Android SDK not found; set ANDROID_HOME to build the app.\n${runInstructions(context)}`,
      };
    }
    const adb = resolveAdb(sdk);
    const devices = await listAndroidDevices(adb);
    if (devices.length === 0) {
      return {
        launched: false,
        message: `No Android device or emulator is connected.\n${runInstructions(context)}`,
      };
    }
    const requested = process.env.ANDROID_SERIAL;
    const serial = requested && devices.includes(requested) ? requested : devices[0];
    await writeLocalProperties(context.projectDir, sdk);
    await gradle(context.projectDir, "installDebug", { ...process.env, ANDROID_SERIAL: serial });
    const component = `${context.mobile.id}/${MAIN_ACTIVITY}`;
    const { code } = await exec(adb, ["-s", serial, "shell", "am", "start", "-n", component]);
    if (code !== 0) throw new Error(`adb shell am start exited with code ${code}.`);
    return { launched: true, message: `Opened ${context.mobile.name} on ${serial}.` };
  },

  async package(context) {
    const sdk = requireAndroidSdk();
    await writeLocalProperties(context.projectDir, sdk);
    await gradle(context.projectDir, "assembleDebug");
    const apk = path.join(
      context.projectDir,
      "app",
      "build",
      "outputs",
      "apk",
      "debug",
      "app-debug.apk",
    );
    await mkdir(context.distDir, { recursive: true });
    const file = path.join(context.distDir, `${context.mobile.id}-debug.apk`);
    await copyFile(apk, file);
    return { files: [file] };
  },
});
