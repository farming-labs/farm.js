import { mkdirSync } from "node:fs";

/**
 * Where this code runs: `"desktop"` in `farm dev --desktop` and `farm build --desktop`,
 * otherwise `"web"`.
 *
 * In browser code the build replaces this module with one that returns a literal, so
 * `platform() === "desktop"` branches fold away in the client bundle.
 */
export type FarmPlatform = "web" | "desktop";

/** @internal Set by the CLI for `--desktop` and by the desktop server entry. */
const PLATFORM_ENV = "FARM_PLATFORM";
/** @internal The app data directory a desktop shell passes to the server. */
const DESKTOP_DATA_DIR_ENV = "FARM_DESKTOP_DATA_DIR";
/** A data directory for web deployments and tests. */
const DATA_DIR_ENV = "FARM_DATA_DIR";

function readEnv(name: string): string | undefined {
  const value = globalThis.process?.env?.[name];
  return typeof value === "string" && value ? value : undefined;
}

export function platform(): FarmPlatform {
  return readEnv(PLATFORM_ENV) === "desktop" ? "desktop" : "web";
}

/**
 * A directory the app may write to, created on first use.
 *
 * | Mode                 | Directory                                         |
 * | -------------------- | ------------------------------------------------- |
 * | desktop build        | the OS user data directory the shell passes in    |
 * | `farm dev --desktop` | `.farm/data/desktop`                              |
 * | web                  | `FARM_DATA_DIR`, otherwise this throws            |
 *
 * Server only. A desktop app's bundle is read-only and signed, so never write next to the code.
 */
export function appDataDir(): string {
  const dir =
    platform() === "desktop" ? readEnv(DESKTOP_DATA_DIR_ENV) : readEnv(DATA_DIR_ENV);
  if (!dir) {
    throw new Error(
      platform() === "desktop"
        ? "[Farm] appDataDir(): the desktop shell did not pass a data directory. Start the app " +
            "with `farm dev --desktop` or from its packaged build."
        : "[Farm] appDataDir() has no directory on the web. Set FARM_DATA_DIR to a writable " +
            'directory, or check platform() === "desktop" first.',
    );
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}
