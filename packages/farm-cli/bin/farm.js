#!/usr/bin/env node

const { program } = require("commander");

const banner = `
 _______                         
|  ___  |__ _ _ __ _ __ ___     
| |_ /| / _\` | '__| '_ \` _ \\ 
|  _ \\| | (_| | |  | | | | | |
|_| \\_\\_|\\__,_|_|  |_| |_| |_|
`;

program.name("farm").description("Farm.js CLI - A modern React meta-framework").version("0.1.0");
program.addHelpText("beforeAll", `${banner}\n`);

function collectOption(value, previous) {
  return [...(previous || []), value];
}

program
  .command("dev")
  .description("Start development server")
  .option("-p, --port <port>", "Port to run the server on", "3000")
  .option("-r, --root <root>", "Root directory", process.cwd())
  .action(async (options) => {
    try {
      const { startDevServer } = require("../dist/index.js");
      await startDevServer(
        {
          root: options.root,
        },
        parseInt(options.port),
      );
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
      const { buildFarm } = require("../dist/index.js");
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
  .command("generate")
  .description("Generate integration schema artifacts for the detected data layer")
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
      console.error("Failed to generate integration schema artifacts:", error);
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
  .option("--diff", "Show a compact file diff for framework migration dry-runs")
  .option("--write", "Apply framework migration changes; framework migrations are dry-run by default")
  .option("--force", "Overwrite existing files during framework migrations")
  .action(async (source, options) => {
    try {
      const { migrateFarm } = require("../dist/index.js");
      await migrateFarm({
        root: options.root,
        configPath: options.config,
        commands: options.command,
        dryRun: options.dryRun,
        diff: options.diff,
        source,
        write: options.write,
        force: options.force,
      });
    } catch (error) {
      console.error("Failed to run migrations:", error);
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
  .option("--skip-package-json", "Do not add @farmjs/integrations to package.json")
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
