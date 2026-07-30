#!/usr/bin/env node

// Match Vite's startup path by reusing Node's on-disk compilation cache when
// the runtime supports it. Older Node releases keep the existing behavior.
try {
  const nodeModule = require("node:module");
  nodeModule.enableCompileCache?.();
  setTimeout(() => {
    try {
      nodeModule.flushCompileCache?.();
    } catch {}
  }, 10_000).unref();
} catch {}

const { program } = require("commander");
const { version } = require("../package.json");

const banner = `
 _______                         
|  ___  |__ _ _ __ _ __ ___     
| |_ /| / _\` | '__| '_ \` _ \\ 
|  _ \\| | (_| | |  | | | | | |
|_| \\_\\_|\\__,_|_|  |_| |_| |_|
`;

program.name("farm").description("Farm.js CLI - A modern React meta-framework").version(version);
program.addHelpText("beforeAll", `${banner}\n`);

function collectOption(value, previous) {
  return [...(previous || []), value];
}

program
  .command("dev")
  .description("Start development server")
  .option("-p, --port <port>", "Override the port to run the server on")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .option("--cron", "Run configured cron routes in-process during development")
  .action(async (options) => {
    try {
      const { startDevServer } = require("../dist/dev.js");
      const server = await startDevServer(
        {
          root: options.root,
        },
        options.port === undefined ? undefined : parseInt(options.port, 10),
      );
      if (options.cron) {
        const { startFarmCronScheduler } = require("../dist/index.js");
        const address = server.httpServer?.address();
        const port = typeof address === "object" && address ? address.port : 3000;
        const scheduler = await startFarmCronScheduler({
          root: options.root,
          url: `http://localhost:${port}`,
        });
        server.__farmCronScheduler = scheduler;
        server.httpServer?.once("close", () => scheduler.stop());
      }
    } catch (error) {
      console.error("Failed to start development server:", error);
      process.exit(1);
    }
  });

program
  .command("build")
  .description("Build for production")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .option("-p, --preset <preset>", "Nitro preset (node-server, vercel, cloudflare, etc.)")
  .action(async (options) => {
    try {
      const { buildFarm } = require("../dist/build.js");
      await buildFarm({
        root: options.root,
        preset: options.preset,
      });
    } catch (error) {
      console.error("Failed to build:", error);
      process.exit(1);
    }
  });

program
  .command("upgrade")
  .description("Upgrade installed Farm.js packages to a stable or beta release")
  .option("-r, --root <root>", "Project root", process.cwd())
  .option("--latest", "Upgrade to the latest stable release")
  .option("--beta", "Upgrade to the latest beta release")
  .option("--dry-run", "Print the package-manager commands without installing")
  .action(async (options) => {
    try {
      if (options.latest === options.beta) {
        throw new Error("Choose exactly one release channel: --latest (stable) or --beta.");
      }

      const { formatFarmUpgradePlan, upgradeFarm } = require("../dist/index.js");
      const result = await upgradeFarm({
        root: options.root,
        channel: options.beta ? "beta" : "latest",
        dryRun: options.dryRun,
      });
      console.log(formatFarmUpgradePlan(result.plan));
      console.log(
        result.executed
          ? `Upgraded ${result.plan.packages.length} Farm package${
              result.plan.packages.length === 1 ? "" : "s"
            } to ${result.plan.channel}.`
          : "Dry run only. No packages were changed.",
      );
    } catch (error) {
      console.error("Failed to upgrade Farm packages:", error);
      process.exit(1);
    }
  });

program
  .command("generate")
  .description("Generate route/API types and integration schema artifacts")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .option("-c, --config <config>", "Path to farm config file")
  .option(
    "--orm <orm>",
    "Schema target to generate (prisma, drizzle, postgres, mysql, sqlite, mongodb)",
  )
  .option("--dialect <dialect>", "SQL dialect for Drizzle generation (postgres, mysql, sqlite)")
  .option("-o, --output <output>", "Custom output path")
  .action(async (options) => {
    try {
      const { generateFarmArtifacts } = require("../dist/index.js");
      await generateFarmArtifacts({
        root: options.root,
        configPath: options.config,
        orm: options.orm,
        dialect: options.dialect,
        output: options.output,
      });
    } catch (error) {
      console.error("Failed to generate Farm artifacts:", error);
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Inspect project configuration and the running Farm runtime")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .option("-c, --config <config>", "Path to farm config file")
  .option("-p, --port <port>", "Port of a running local app")
  .option("--host <host>", "Host of a running local app")
  .option("--url <url>", "Base URL of a running Farm app")
  .option("--offline", "Inspect project files without probing a running app")
  .option("--timeout <ms>", "Live runtime probe timeout in milliseconds", "1200")
  .option("--json", "Print machine-readable JSON")
  .action(async (options) => {
    try {
      const { formatFarmDoctorReport, runFarmDoctor } = require("../dist/index.js");
      const timeoutMs = Number.parseInt(options.timeout, 10);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error("--timeout must be a positive number of milliseconds.");
      }
      const report = await runFarmDoctor({
        root: options.root,
        configPath: options.config,
        port: options.port,
        host: options.host,
        url: options.url,
        offline: options.offline,
        timeoutMs,
      });
      console.log(options.json ? JSON.stringify(report, null, 2) : formatFarmDoctorReport(report));
      if (report.health === "error") process.exitCode = 1;
    } catch (error) {
      console.error("Failed to inspect Farm app:", error);
      process.exit(1);
    }
  });

program
  .command("preview")
  .description("Create a public URL for a running local Farm app")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .option("-c, --config <config>", "Path to farm config file")
  .option("-p, --port <port>", "Port of the running local app")
  .option("--host <host>", "Host of the running local app", "localhost")
  .option("--url <url>", "Full local URL to expose")
  .option(
    "--gateway <url>",
    "Advanced: override the hosted Farm Preview gateway URL",
    process.env.FARM_PREVIEW_GATEWAY_URL,
  )
  .option(
    "--provider <provider>",
    "Advanced: preview provider to use (farm, local)",
    process.env.FARM_PREVIEW_PROVIDER,
  )
  .option("--name <name>", "Readable preview URL name")
  .option("--dry-run", "Validate target detection and print the preview plan without opening it")
  .option("--no-probe", "Skip local reachability check when --port is provided")
  .action(async (options) => {
    try {
      const { previewFarm } = require("../dist/index.js");
      await previewFarm({
        root: options.root,
        configPath: options.config,
        port: options.port,
        host: options.host,
        url: options.url,
        gatewayUrl: options.gateway,
        name: options.name,
        dryRun: options.dryRun,
        noProbe: options.noProbe,
        provider: options.provider,
      });
    } catch (error) {
      console.error("Failed to create preview:", error);
      process.exit(1);
    }
  });

program
  .command("migrate [source]")
  .description("Run one-shot migration commands or migrate from another framework")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .option("-c, --config <config>", "Path to farm config file")
  .option("--command <command>", "Migration command to run; can be repeated", collectOption, [])
  .option("--dry-run", "Print migration commands without running them")
  .option(
    "--write",
    "Apply framework migration changes; framework migrations are dry-run by default",
  )
  .option("--force", "Overwrite existing files during framework migrations")
  .action(async (source, options) => {
    try {
      const { migrateFarm } = require("../dist/index.js");
      await migrateFarm({
        root: options.root,
        configPath: options.config,
        commands: options.command,
        dryRun: options.dryRun,
        source,
        write: options.write,
        force: options.force,
      });
    } catch (error) {
      console.error("Failed to run migrations:", error);
      process.exit(1);
    }
  });

const cronCommand = program
  .command("cron")
  .description("Inspect and manually run framework-native cron routes");

cronCommand
  .command("list")
  .description("List cron routes configured in farm.config")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .option("-c, --config <config>", "Path to farm config file")
  .option("--json", "Print machine-readable JSON")
  .action(async (options) => {
    try {
      const { formatFarmCronJobs, listFarmCronJobs } = require("../dist/index.js");
      const jobs = await listFarmCronJobs({
        root: options.root,
        configPath: options.config,
      });
      console.log(options.json ? JSON.stringify(jobs, null, 2) : formatFarmCronJobs(jobs));
    } catch (error) {
      console.error("Failed to list cron routes:", error);
      process.exit(1);
    }
  });

cronCommand
  .command("run <name>")
  .description("Invoke one configured cron route on a running Farm app")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .option("-c, --config <config>", "Path to farm config file")
  .option("-p, --port <port>", "Port of the running local app", "3000")
  .option("--host <host>", "Host of the running local app", "localhost")
  .option("--url <url>", "Base URL of a running Farm app")
  .option("--secret <secret>", "Bearer secret (defaults to CRON_SECRET)")
  .option("--json", "Print the complete invocation result as JSON")
  .action(async (name, options) => {
    try {
      const { runFarmCronJob } = require("../dist/index.js");
      const result = await runFarmCronJob(name, {
        root: options.root,
        configPath: options.config,
        port: options.port,
        host: options.host,
        url: options.url,
        secret: options.secret,
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          `Cron ${result.job.name} completed with ${result.status} in ${result.durationMs}ms.`,
        );
        if (result.body !== null && result.body !== undefined && result.body !== "") {
          console.log(
            typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2),
          );
        }
      }
    } catch (error) {
      console.error("Failed to run cron route:", error);
      process.exit(1);
    }
  });

const addCommand = program.command("add").description("Add Farm.js components to the current app");

addCommand
  .command("integration [provider]")
  .alias("integrations")
  .description("Add an official Farm.js integration to the app registry")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .option("-k, --key <key>", "Registry key to use in appIntegrations")
  .option("-f, --file <file>", "Path to the app integrations registry", "src/lib/integrations.ts")
  .option("--force", "Overwrite an existing generated integration component")
  .option("--dry-run", "Show what would be added without writing files")
  .option("--route-file <file>", "Route file path for route-based integrations")
  .option("--ui", "Also install the provider's shadcn-based Farm UI feature pack")
  .option("--skip-package-json", "Do not add @farm.js/integrations to package.json")
  .option("--skip-config", "Do not create or update farm.config")
  .option("-l, --list", "List supported integration providers")
  .action(async (provider, options) => {
    try {
      const {
        addFarmIntegration,
        listFarmIntegrationProviders,
      } = require("../dist/add-integration.js");

      if (options.list) {
        for (const entry of listFarmIntegrationProviders()) {
          console.log(`${entry.name.padEnd(13)} ${entry.description}`);
        }
        return;
      }

      if (!provider) {
        console.error("Please pass an integration provider, or use --list.");
        process.exit(1);
      }

      const result = await addFarmIntegration({
        root: options.root,
        provider,
        key: options.key,
        integrationsFile: options.file,
        routeFile: options.routeFile,
        ui: options.ui,
        dryRun: options.dryRun,
        force: options.force,
        skipPackageJson: options.skipPackageJson,
        skipConfig: options.skipConfig,
      });

      const verb = options.dryRun ? "Prepared" : "Added";
      if (result.mode === "route") {
        console.log(`${verb} ${result.provider} route at ${result.routePath || result.routeFile}`);
      } else {
        console.log(`${verb} ${result.provider} integration as appIntegrations.${result.key}`);
      }

      if (result.ui) {
        console.log(`UI feature: ${result.ui.feature}`);
        if (result.ui.components.length) {
          console.log(`Shadcn components: ${result.ui.components.join(", ")}`);
        }
      }

      if (result.created.length) {
        console.log("Created:");
        for (const file of result.created) {
          console.log(`  ${file}`);
        }
      }

      if (result.updated.length) {
        console.log("Updated:");
        for (const file of result.updated) {
          console.log(`  ${file}`);
        }
      }

      if (result.env.length) {
        console.log("Environment:");
        for (const key of result.env) {
          console.log(`  ${key}`);
        }
      }

      if (result.notes.length) {
        console.log("Notes:");
        for (const note of result.notes) {
          console.log(`  ${note}`);
        }
      }
    } catch (error) {
      console.error("Failed to add integration:", error);
      process.exit(1);
    }
  });

program
  .command("deploy")
  .description("Deploy to a platform from deploy.target or a platform flag")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .option("--vercel", "Deploy to Vercel")
  .option("--cloudflare", "Deploy to Cloudflare")
  .option("--netlify", "Deploy to Netlify")
  .option("--prod", "Deploy to production (Vercel: uses prebuilt output)")
  .option("--custom", "Use your own credentials (not Farm.js managed)")
  .action(async (options) => {
    try {
      const { deployFarm } = require("../dist/index.js");
      await deployFarm(options);
    } catch (error) {
      console.error("Failed to deploy:", error);
      process.exit(1);
    }
  });

program.parse();
