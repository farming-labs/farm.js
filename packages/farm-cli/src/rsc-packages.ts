import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  findFarmAppPackageDir,
  inspectFarmServerComponents,
  logger,
} from "@farm.js/core/internal/cli-runtime";
import {
  detectFarmPackageManager,
  runFarmUpgradeCommand,
  type FarmPackageManager,
  type FarmUpgradeCommand,
} from "./upgrade";

/** Peers of `@farm.js/plugin` that React Server Components need, at the versions it pins. */
const FARM_RSC_PEERS = ["@vitejs/plugin-rsc", "react", "react-dom", "react-server-dom-webpack"];

function readManifest(dir: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
}

function installedVersion(root: string, name: string): string | undefined {
  const dir = findFarmAppPackageDir(root, name);
  return dir ? readManifest(dir).version : undefined;
}

const LOCKFILES = [
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
];

/** The app's package manager: its own lockfile or `packageManager`, else the workspace root's. */
function detectPackageManager(root: string): FarmPackageManager {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const manifest = existsSync(path.join(dir, "package.json")) ? readManifest(dir) : undefined;
    if (
      typeof manifest?.packageManager === "string" ||
      LOCKFILES.some((lockfile) => existsSync(path.join(dir, lockfile)))
    ) {
      return detectFarmPackageManager(dir, manifest?.packageManager);
    }
    if (path.dirname(dir) === dir) return detectFarmPackageManager(root);
  }
}

function isTrue(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

function isContinuousIntegration(env: NodeJS.ProcessEnv): boolean {
  return isTrue(env.CI) || isTrue(env.GITHUB_ACTIONS) || isTrue(env.BUILDKITE);
}

/**
 * Turning on `experimental.serverComponents` is the whole setup: `farm dev` and `farm build`
 * install what React Server Components need, with the app's package manager. `@farm.js/plugin`
 * matches the installed `@farm.js/core`; its RSC peers are installed at the exact versions it pins.
 *
 * An app that set `true` before the flag ran RSC and uses config RSC cannot run (`auth`,
 * `integrations`, ...) is left alone and keeps its fallback, so an upgrade never breaks it.
 *
 * CI never changes package.json or the lockfile: `true` keeps its fallback there, and an
 * explicit mode fails with the command to run.
 */
export async function ensureFarmRscPackages(
  config: Record<string, any> | null | undefined,
  root: string,
  run: (command: FarmUpgradeCommand) => Promise<void> = runFarmUpgradeCommand,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  // Opt-out for setups that must never change package.json, and for tests.
  if (env.FARM_SKIP_RSC_INSTALL === "1") return [];
  const status = inspectFarmServerComponents(config, root);
  if (!status.enabled || status.missingPackages.length === 0) return [];
  if (!status.explicit && status.blockingKeys.length > 0) return [];

  const packageManager = detectPackageManager(root);
  const verb = packageManager === "npm" ? "install" : "add";
  if (isContinuousIntegration(env)) {
    if (!status.explicit) return [];
    throw new Error(
      `[Farm.js] experimental.serverComponents needs ${status.missingPackages.join(", ")}, which ${
        status.missingPackages.length === 1 ? "is" : "are"
      } not installed. CI does not change dependencies: run \`${packageManager} ${verb} ${status.missingPackages.join(" ")}\` and commit the result.`,
    );
  }
  const installed: string[] = [];
  const add = async (specs: string[]) => {
    logger.info(`[Farm.js] Installing React Server Components packages: ${specs.join(" ")}`);
    await run({ command: packageManager, args: [verb, ...specs], cwd: root });
    installed.push(...specs);
  };

  if (!findFarmAppPackageDir(root, "@farm.js/plugin")) {
    const coreVersion = installedVersion(root, "@farm.js/core");
    await add([coreVersion ? `@farm.js/plugin@${coreVersion}` : "@farm.js/plugin"]);
  }
  const pluginDir = findFarmAppPackageDir(root, "@farm.js/plugin");
  const peers: Record<string, string> = pluginDir
    ? (readManifest(pluginDir).peerDependencies ?? {})
    : {};
  const specs = FARM_RSC_PEERS.filter((name) => {
    const wanted = peers[name];
    if (!wanted) return false;
    const current = installedVersion(root, name);
    // An exact pin must match; a range only needs the package to be there.
    return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(wanted) ? current !== wanted : !current;
  }).map((name) => `${name}@${peers[name]}`);
  if (specs.length > 0) await add(specs);
  return installed;
}
