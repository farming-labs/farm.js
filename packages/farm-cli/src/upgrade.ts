import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type FarmUpgradeChannel = "latest" | "beta";
export type FarmPackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type FarmDependencySection =
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies"
  | "peerDependencies";

export interface FarmUpgradePackage {
  name: string;
  current: string;
  target: string;
  section: FarmDependencySection;
}

export interface FarmSkippedUpgradePackage {
  name: string;
  current: string;
  reason: string;
  section: FarmDependencySection;
}

export interface FarmUpgradeCommand {
  command: FarmPackageManager;
  args: string[];
  cwd: string;
}

export interface FarmUpgradePlan {
  root: string;
  packageJsonPath: string;
  packageManager: FarmPackageManager;
  channel: FarmUpgradeChannel;
  packages: FarmUpgradePackage[];
  skipped: FarmSkippedUpgradePackage[];
  commands: FarmUpgradeCommand[];
}

export interface FarmUpgradeOptions {
  root?: string;
  channel: FarmUpgradeChannel;
  dryRun?: boolean;
  packageManager?: FarmPackageManager;
  runCommand?: FarmUpgradeCommandRunner;
}

export interface FarmUpgradeResult {
  plan: FarmUpgradePlan;
  executed: boolean;
}

export type FarmUpgradeCommandRunner = (command: FarmUpgradeCommand) => Promise<void>;

type ProjectPackageJson = {
  packageManager?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
};

const DEPENDENCY_SECTIONS: readonly FarmDependencySection[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const LOCAL_SPECIFIER_PREFIXES = ["workspace:", "file:", "link:", "portal:", "catalog:"] as const;

export async function createFarmUpgradePlan(options: FarmUpgradeOptions): Promise<FarmUpgradePlan> {
  assertUpgradeChannel(options.channel);

  const root = path.resolve(options.root || process.cwd());
  const packageJsonPath = path.join(root, "package.json");
  let packageJson: ProjectPackageJson;

  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as ProjectPackageJson;
  } catch (error) {
    if (!existsSync(packageJsonPath)) {
      throw new Error(`No package.json found at ${packageJsonPath}.`);
    }
    throw new Error(`Could not read ${packageJsonPath}: ${formatError(error)}`);
  }

  const packageManager =
    options.packageManager || detectFarmPackageManager(root, packageJson.packageManager);
  const packages: FarmUpgradePackage[] = [];
  const skipped: FarmSkippedUpgradePackage[] = [];
  const seen = new Set<string>();

  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = packageJson[section];
    if (!dependencies || typeof dependencies !== "object") continue;

    for (const [name, rawSpecifier] of Object.entries(dependencies)) {
      if (!name.startsWith("@farm.js/") || seen.has(name)) continue;
      seen.add(name);

      const current = typeof rawSpecifier === "string" ? rawSpecifier : String(rawSpecifier);
      if (isLocalSpecifier(current)) {
        skipped.push({
          name,
          current,
          section,
          reason: "local workspace and file dependencies are not published-package upgrades",
        });
        continue;
      }

      packages.push({
        name,
        current,
        section,
        target: `${name}@${options.channel}`,
      });
    }
  }

  if (packages.length === 0) {
    const suffix =
      skipped.length > 0
        ? " The Farm packages in this project use local workspace or file references."
        : "";
    throw new Error(
      `No published @farm.js/* dependencies were found in ${packageJsonPath}.${suffix}`,
    );
  }

  packages.sort((left, right) => left.name.localeCompare(right.name));
  skipped.sort((left, right) => left.name.localeCompare(right.name));

  return {
    root,
    packageJsonPath,
    packageManager,
    channel: options.channel,
    packages,
    skipped,
    commands: createUpgradeCommands(root, packageManager, packages),
  };
}

export async function upgradeFarm(options: FarmUpgradeOptions): Promise<FarmUpgradeResult> {
  const plan = await createFarmUpgradePlan(options);
  if (options.dryRun) {
    return { plan, executed: false };
  }

  const runCommand = options.runCommand || runFarmUpgradeCommand;
  for (const command of plan.commands) {
    await runCommand(command);
  }

  return { plan, executed: true };
}

export function formatFarmUpgradePlan(plan: FarmUpgradePlan): string {
  const release = plan.channel === "latest" ? "latest stable" : "latest beta";
  const lines = [
    `Farm upgrade: ${release}`,
    `Project: ${plan.root}`,
    `Package manager: ${plan.packageManager}`,
    "Packages:",
  ];

  for (const entry of plan.packages) {
    lines.push(`  ${entry.name} (${entry.section}): ${entry.current} -> ${plan.channel}`);
  }

  if (plan.skipped.length > 0) {
    lines.push("Skipped local packages:");
    for (const entry of plan.skipped) {
      lines.push(`  ${entry.name} (${entry.current})`);
    }
  }

  lines.push("Commands:");
  for (const command of plan.commands) {
    lines.push(`  ${command.command} ${command.args.join(" ")}`);
  }

  return lines.join("\n");
}

export function detectFarmPackageManager(
  root: string,
  packageManagerField?: unknown,
): FarmPackageManager {
  if (typeof packageManagerField === "string") {
    const name = packageManagerField.split("@", 1)[0];
    if (isFarmPackageManager(name)) return name;
  }

  const lockfileCandidates: Array<[FarmPackageManager, string[]]> = [
    ["pnpm", ["pnpm-lock.yaml"]],
    ["yarn", ["yarn.lock"]],
    ["bun", ["bun.lock", "bun.lockb"]],
    ["npm", ["package-lock.json", "npm-shrinkwrap.json"]],
  ];

  for (const [packageManager, lockfiles] of lockfileCandidates) {
    if (lockfiles.some((lockfile) => existsSync(path.join(root, lockfile)))) {
      return packageManager;
    }
  }

  return "npm";
}

function createUpgradeCommands(
  root: string,
  packageManager: FarmPackageManager,
  packages: FarmUpgradePackage[],
): FarmUpgradeCommand[] {
  const command = packageManager === "npm" ? "install" : "add";

  return DEPENDENCY_SECTIONS.flatMap((section) => {
    const targets = packages
      .filter((entry) => entry.section === section)
      .map((entry) => entry.target);
    if (targets.length === 0) return [];

    return [
      {
        command: packageManager,
        args: [command, ...getDependencySectionFlags(packageManager, section), ...targets],
        cwd: root,
      },
    ];
  });
}

function getDependencySectionFlags(
  packageManager: FarmPackageManager,
  section: FarmDependencySection,
): string[] {
  if (section === "dependencies") return [];

  if (packageManager === "yarn" || packageManager === "bun") {
    if (section === "devDependencies") return ["--dev"];
    if (section === "optionalDependencies") return ["--optional"];
    return ["--peer"];
  }

  if (section === "devDependencies") return ["--save-dev"];
  if (section === "optionalDependencies") return ["--save-optional"];
  return ["--save-peer"];
}

function runFarmUpgradeCommand(command: FarmUpgradeCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const executable = process.platform === "win32" ? `${command.command}.cmd` : command.command;
    const child = spawn(executable, command.args, {
      cwd: command.cwd,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const termination = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      reject(new Error(`${command.command} ${command.args.join(" ")} failed with ${termination}.`));
    });
  });
}

function isLocalSpecifier(specifier: string): boolean {
  return LOCAL_SPECIFIER_PREFIXES.some((prefix) => specifier.startsWith(prefix));
}

function isFarmPackageManager(value: string): value is FarmPackageManager {
  return value === "npm" || value === "pnpm" || value === "yarn" || value === "bun";
}

function assertUpgradeChannel(channel: FarmUpgradeChannel): void {
  if (channel !== "latest" && channel !== "beta") {
    throw new Error('Farm upgrade channel must be "latest" or "beta".');
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
