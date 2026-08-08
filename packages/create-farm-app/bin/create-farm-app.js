#!/usr/bin/env node

const { program } = require("commander");
const { createApp } = require("../dist/index.js");
const { version } = require("../package.json");

program
  .name("create-farm-app")
  .description("Create a new FARMJS application")
  .version(version)
  .argument("[project-name]", "Name of the project")
  .option("-t, --template <template>", "Template to use")
  .option("--typescript", "Use TypeScript template")
  .option("--skip-install", "Skip installing dependencies")
  .action(async (projectName, options) => {
    try {
      await createApp(projectName, options);
    } catch (error) {
      console.error("Failed to create app:", error);
      process.exit(1);
    }
  });

program.parse();
