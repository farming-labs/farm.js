import { loadConfig, logger } from "@farmjs/core";
import { spawn } from "node:child_process";
import path from "node:path";

type FarmMigrationCommand =
  | string
  | {
      command: string;
      name?: string;
      cwd?: string;
      env?: Record<string, string | undefined>;
      skip?: boolean;
    };

type FarmMigrationsUserConfig = { commands?: FarmMigrationCommand[] } | FarmMigrationCommand[];

export interface MigrateFarmOptions {
  root?: string;
  configPath?: string;
  commands?: string[];
  dryRun?: boolean;
}

interface ResolvedMigrationCommand {
  command: string;
  name: string;
  cwd: string;
  env?: Record<string, string | undefined>;
}

export async function migrateFarm(options: MigrateFarmOptions = {}) {
  const root = path.resolve(options.root || process.cwd());
  const cliCommands = options.commands?.filter(Boolean) || [];
  const userConfig = await loadConfig(root, options.configPath, "development");
  const configuredCommands = getConfiguredCommands(userConfig?.migrations);
  const commandEntries = cliCommands.length ? cliCommands : configuredCommands;
  const commands = commandEntries
    .map((entry, index) => resolveMigrationCommand(root, entry, index))
    .filter((entry): entry is ResolvedMigrationCommand => !!entry);

  if (!commands.length) {
    throw new Error(
      "No migrations configured. Add migrations.commands to farm.config.ts or pass --command.",
    );
  }

  if (options.dryRun) {
    logger.info(`Found ${formatCount(commands.length)} to run:`);
    for (const command of commands) {
      logger.info(`  ${command.name}: ${command.command}`);
    }
    return;
  }

  for (const command of commands) {
    logger.info(`Running ${command.name}: ${command.command}`);
    await runMigrationCommand(command);
  }

  logger.success(`Ran ${formatCount(commands.length)} successfully.`);
}

function getConfiguredCommands(migrations: FarmMigrationsUserConfig | undefined) {
  if (!migrations) return [];
  if (Array.isArray(migrations)) return migrations;
  return migrations.commands || [];
}

function resolveMigrationCommand(
  root: string,
  entry: FarmMigrationCommand,
  index: number,
): ResolvedMigrationCommand | null {
  if (typeof entry === "string") {
    const command = entry.trim();
    if (!command) {
      throw new Error(`Migration command ${index + 1} is empty.`);
    }

    return {
      command,
      name: `migration ${index + 1}`,
      cwd: root,
    };
  }

  if (entry.skip) return null;
  const command = entry.command.trim();
  if (!command) {
    throw new Error(`Migration command ${index + 1} is empty.`);
  }

  return {
    command,
    name: entry.name || `migration ${index + 1}`,
    cwd: entry.cwd ? path.resolve(root, entry.cwd) : root,
    env: entry.env,
  };
}

function runMigrationCommand(command: ResolvedMigrationCommand) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command.command, {
      cwd: command.cwd,
      env: {
        ...process.env,
        ...command.env,
      },
      shell: true,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${command.name} failed with ${reason}.`));
    });
  });
}

function formatCount(count: number) {
  return `${count} migration command${count === 1 ? "" : "s"}`;
}
