import prompts from "prompts";
import path from "path";
import fs from "fs/promises";
import { logger, showBanner } from "./utils";

interface CreateAppOptions {
  template?: string;
  typescript?: boolean;
}

export async function createApp(projectName?: string, options: CreateAppOptions = {}) {
  showBanner();

  const templates = await getAvailableTemplates();
  if (templates.length === 0) {
    logger.error("No templates are available in this package.");
    process.exit(1);
  }

  // Get project name if not provided
  if (!projectName) {
    const response = await prompts({
      type: "text",
      name: "projectName",
      message: "What is your project named?",
      initial: "my-farm-app",
      validate: validateProjectName,
    });

    if (!response.projectName) {
      logger.error("Operation cancelled.");
      process.exit(1);
    }

    projectName = response.projectName;
  } else {
    const validation = validateProjectPathArg(projectName);
    if (validation !== true) {
      logger.error(validation);
      process.exit(1);
    }
  }

  // Get template if not provided
  let template = options.template;
  if (!template) {
    const response = await prompts({
      type: "select",
      name: "template",
      message: "Which template would you like to use?",
      choices: templates.map((name) => ({
        title: prettifyTemplateName(name),
        value: name,
        description:
          name === "basic" ? "A simple Farm.js app with built-in Tailwind support" : undefined,
      })),
      initial: 0,
    });

    if (!response.template) {
      logger.error("Operation cancelled.");
      process.exit(1);
    }
    template = response.template;
  } else if (!templates.includes(template)) {
    logger.error(
      `Unknown template "${template}". Available: ${templates.map((t) => `"${t}"`).join(", ")}`,
    );
    process.exit(1);
  }

  // Check TypeScript preference
  let useTypeScript = options.typescript;
  if (useTypeScript === undefined) {
    const response = await prompts({
      type: "confirm",
      name: "typescript",
      message: "Would you like to use TypeScript?",
      initial: true,
    });

    if (response.typescript === undefined) {
      logger.error("Operation cancelled.");
      process.exit(1);
    }
    useTypeScript = response.typescript;
  }

  const projectPath = path.resolve(process.cwd(), projectName!);
  const hasExistingFiles = await directoryHasFiles(projectPath);
  if (hasExistingFiles) {
    const overwriteResponse = await prompts({
      type: "confirm",
      name: "overwrite",
      message: `Directory "${projectName}" is not empty. Continue and overwrite conflicting files?`,
      initial: false,
    });

    if (!overwriteResponse.overwrite) {
      logger.error("Operation cancelled.");
      process.exit(1);
    }
  }

  logger.info(`Creating Farm.js app in ${projectPath}`);

  await fs.mkdir(projectPath, { recursive: true });

  await copyTemplate(template!, projectPath, useTypeScript!);

  await updatePackageJson(projectPath, projectName!);

  logger.success(`🚜 Created ${projectName}`);
  logger.info("");
  logger.info("Next steps");
  logger.info(`  cd ${projectName}`);
  logger.info("  pnpm install");
  logger.info("  pnpm dev");
  logger.info("");
  logger.info("Tailwind is enabled by default. You only need postcss config for custom plugins.");
}

async function copyTemplate(template: string, projectPath: string, useTypeScript: boolean) {
  const templatePath = path.join(__dirname, "..", "templates", template);

  // Copy base template files
  await copyDir(templatePath, projectPath);

  // If TypeScript is requested, copy TS-specific files
  if (useTypeScript) {
    const tsTemplatePath = path.join(__dirname, "..", "templates", "_typescript");
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
    // npm excludes .gitignore files from published tarballs. Keep the template
    // file publishable and restore its dot when generating the application.
    const destinationName = entry.name === "gitignore" ? ".gitignore" : entry.name;
    const destPath = path.join(dest, destinationName);

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

async function directoryHasFiles(dirPath: string): Promise<boolean> {
  if (!(await dirExists(dirPath))) {
    return false;
  }
  const files = await fs.readdir(dirPath);
  return files.length > 0;
}

function validateProjectName(value: string): true | string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Project name is required";
  }

  // npm package-safe pattern
  if (!/^[a-z0-9._-]+$/i.test(trimmed)) {
    return "Use letters, numbers, hyphens, underscores, or dots";
  }

  if (trimmed.startsWith(".") || trimmed.startsWith("_")) {
    return "Project name cannot start with '.' or '_'";
  }

  return true;
}

function validateProjectPathArg(value: string): true | string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Project name is required";
  }

  const normalized = trimmed.replace(/[\\/]+$/, "");
  const baseName = path.basename(normalized);
  if (!baseName || baseName === "." || baseName === "..") {
    return "Please provide a valid project directory name";
  }

  return validateProjectName(baseName);
}

function prettifyTemplateName(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function getAvailableTemplates(): Promise<string[]> {
  const templatesRoot = path.join(__dirname, "..", "templates");
  const entries = await fs.readdir(templatesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

async function updatePackageJson(projectPath: string, projectName: string) {
  const packageJsonPath = path.join(projectPath, "package.json");

  try {
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    packageJson.name = projectName;

    await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  } catch (error) {
    logger.warn("Could not update package.json");
  }
}
