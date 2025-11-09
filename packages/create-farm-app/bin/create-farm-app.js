#!/usr/bin/env node

const { program } = require('commander');
const { createApp } = require('../dist/index.js');

program
  .name('create-farm-app')
  .description('Create a new Farm.js application')
  .version('0.1.0')
  .argument('[project-name]', 'Name of the project')
  .option('-t, --template <template>', 'Template to use', 'basic')
  .option('--typescript', 'Use TypeScript template')
  .action(async (projectName, options) => {
    try {
      await createApp(projectName, options);
    } catch (error) {
      console.error('Failed to create app:', error);
      process.exit(1);
    }
  });

program.parse();
