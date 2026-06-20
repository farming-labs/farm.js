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
  .command("deploy")
  .description("Deploy to a platform")
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
