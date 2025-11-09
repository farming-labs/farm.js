import prompts from 'prompts';
import path from 'path';
import fs from 'fs/promises';
import { logger } from './utils';

interface CreateAppOptions {
  template?: string;
  typescript?: boolean;
}

export async function createApp(projectName?: string, options: CreateAppOptions = {}) {
  // Get project name if not provided
  if (!projectName) {
    const response = await prompts({
      type: 'text',
      name: 'projectName',
      message: 'What is your project named?',
      initial: 'my-farm-app',
    });

    if (!response.projectName) {
      logger.error('Project name is required');
      process.exit(1);
    }

    projectName = response.projectName;
  }

  // Get template if not provided
  let template = options.template;
  if (!template) {
    const response = await prompts({
      type: 'select',
      name: 'template',
      message: 'Which template would you like to use?',
      choices: [
        { title: 'Basic', value: 'basic', description: 'A simple Farm.js app' },
        {
          title: 'With Database',
          value: 'with-database',
          description: 'Farm.js app with database integration',
        },
        { title: 'E-commerce', value: 'e-commerce', description: 'Full e-commerce example' },
      ],
      initial: 0,
    });

    template = response.template || 'basic';
  }

  // Check TypeScript preference
  let useTypeScript = options.typescript;
  if (useTypeScript === undefined) {
    const response = await prompts({
      type: 'confirm',
      name: 'typescript',
      message: 'Would you like to use TypeScript?',
      initial: true,
    });

    useTypeScript = response.typescript;
  }

  const projectPath = path.resolve(process.cwd(), projectName!);

  logger.info(`Creating Farm.js app in ${projectPath}`);

  await fs.mkdir(projectPath, { recursive: true });

  await copyTemplate(template!, projectPath, useTypeScript!);

  await updatePackageJson(projectPath, projectName!);

  logger.success(`🚜 Created ${projectName}`);
  logger.info('');
  logger.info('Next steps:');
  logger.info(`  cd ${projectName}`);
  logger.info('  pnpm install');
  logger.info('  pnpm dev');
}

async function copyTemplate(template: string, projectPath: string, useTypeScript: boolean) {
  const templatePath = path.join(__dirname, '..', 'templates', template);

  // Copy base template files
  await copyDir(templatePath, projectPath);

  // If TypeScript is requested, copy TS-specific files
  if (useTypeScript) {
    const tsTemplatePath = path.join(__dirname, '..', 'templates', '_typescript');
    if (await dirExists(tsTemplatePath)) {
      await copyDir(tsTemplatePath, projectPath);
    }
  }
}

async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function updatePackageJson(projectPath: string, projectName: string) {
  const packageJsonPath = path.join(projectPath, 'package.json');

  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);

    packageJson.name = projectName;

    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
  } catch (error) {
    logger.warn('Could not update package.json name');
  }
}
