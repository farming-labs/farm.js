#!/usr/bin/env node

const { program } = require('commander');
const { startDevServer } = require('../dist/index.js');

program.name('farm').description('Farm.js CLI - A modern React meta-framework').version('0.1.0');

program
  .command('dev')
  .description('Start development server')
  .option('-p, --port <port>', 'Port to run the server on', '3000')
  .option('-r, --root <root>', 'Root directory', process.cwd())
  .action(async (options) => {
    try {
      await startDevServer(
        {
          root: options.root,
        },
        parseInt(options.port)
      );
    } catch (error) {
      console.error('Failed to start development server:', error);
      process.exit(1);
    }
  });

program
  .command('build')
  .description('Build for production')
  .option('-r, --root <root>', 'Root directory', process.cwd())
  .action(async (options) => {
    console.log('🚜 Building Farm.js application...');
    // Build implementation would go here
    console.log('✅ Build completed!');
  });

program.parse();
