import prompts from "prompts";
import path from "path";
import fs from "fs/promises";
import { spawn } from "node:child_process";
import {
  addFarmIntegration,
  type AddFarmIntegrationResult,
  type FarmIntegrationProvider,
} from "@farm.js/cli/add-integration";
import { logger, showBanner } from "./utils";

interface CreateAppOptions {
  template?: string;
  renderer?: string;
  typescript?: boolean;
  skipInstall?: boolean;
  listTemplates?: boolean;
}

interface TemplateDetails {
  title: string;
  description: string;
  instructions: string[];
  integration?: {
    provider: FarmIntegrationProvider;
    label: string;
    route: string;
    docsPath: string;
  };
}

const templateDetails: Record<string, TemplateDetails> = {
  basic: {
    title: "Basic starter",
    description: "A minimal Farm.js app with built-in Tailwind support",
    instructions: [
      "Tailwind is enabled by default. You only need postcss config for custom plugins.",
    ],
  },
  auth: {
    title: "Auth starter",
    description: "Farm.js-native auth with local SQLite, secure sessions, and protected routes",
    instructions: [
      "FARMJS Auth uses local SQLite automatically; no auth environment variables are needed locally.",
      "For production, set FARM_AUTH_URL, FARM_AUTH_SECRET, and DATABASE_URL, then run the auth:migrate script.",
    ],
  },
  "better-auth": {
    title: "Better Auth starter",
    description: "Better Auth with Postgres, secure sessions, and protected routes",
    instructions: [
      "Before starting, copy .env.example to .env.local and set DATABASE_URL and BETTER_AUTH_SECRET.",
      "Better Auth migrations run automatically when the auth instance starts.",
    ],
  },
  ai: integrationTemplate({
    title: "AI starter",
    description: "AI SDK chat route with a ready-to-use chat interface",
    provider: "ai",
    label: "AI",
    route: "/integrations/ai",
    docsPath: "/docs/integrations",
  }),
  auth0: integrationTemplate({
    title: "Auth0 starter",
    description: "Auth0 login, sessions, protected routes, and account controls",
    provider: "auth0",
    label: "Auth0",
    route: "/integrations/auth0",
    docsPath: "/docs/integrations/auth/auth0",
  }),
  authjs: integrationTemplate({
    title: "Auth.js starter",
    description: "Auth.js with GitHub OAuth and Farm-owned route mounting",
    provider: "authjs",
    label: "Auth.js",
    route: "/integrations/authjs",
    docsPath: "/docs/integrations/auth/authjs",
  }),
  autumn: integrationTemplate({
    title: "Autumn starter",
    description: "Autumn products, checkout, billing state, and customer portal",
    provider: "autumn",
    label: "Autumn",
    route: "/integrations/autumn",
    docsPath: "/docs/integrations/autumn",
  }),
  clerk: integrationTemplate({
    title: "Clerk starter",
    description: "Clerk authentication, account entry points, and protected routes",
    provider: "clerk",
    label: "Clerk",
    route: "/integrations/clerk",
    docsPath: "/docs/integrations/auth/clerk",
  }),
  "jobs-inngest": integrationTemplate({
    title: "Inngest starter",
    description: "Typed background jobs backed by Inngest",
    provider: "jobs-inngest",
    label: "Inngest",
    route: "/integrations/jobs-inngest",
    docsPath: "/docs/integrations/inngest",
  }),
  "jobs-trigger": integrationTemplate({
    title: "Trigger.dev starter",
    description: "Typed background jobs backed by Trigger.dev",
    provider: "jobs-trigger",
    label: "Trigger.dev",
    route: "/integrations/jobs-trigger",
    docsPath: "/docs/integrations/trigger",
  }),
  polar: integrationTemplate({
    title: "Polar starter",
    description: "Polar products, checkout, billing state, and customer portal",
    provider: "polar",
    label: "Polar",
    route: "/integrations/polar",
    docsPath: "/docs/integrations/polar",
  }),
  resend: integrationTemplate({
    title: "Resend starter",
    description: "Resend templates, delivery, scheduling, and webhooks",
    provider: "resend",
    label: "Resend",
    route: "/integrations/resend",
    docsPath: "/docs/integrations/email",
  }),
  stripe: integrationTemplate({
    title: "Stripe starter",
    description: "Stripe products, checkout, billing portal, and webhooks",
    provider: "stripe",
    label: "Stripe",
    route: "/integrations/stripe",
    docsPath: "/docs/integrations/stripe",
  }),
  supabase: integrationTemplate({
    title: "Supabase starter",
    description: "Supabase authentication, sessions, OAuth, and protected routes",
    provider: "supabase",
    label: "Supabase",
    route: "/integrations/supabase",
    docsPath: "/docs/integrations/auth/supabase",
  }),
  unkey: integrationTemplate({
    title: "Unkey starter",
    description: "Unkey API key creation, verification, and route protection",
    provider: "unkey",
    label: "Unkey",
    route: "/integrations/unkey",
    docsPath: "/docs/integrations/unkey",
  }),
  workos: integrationTemplate({
    title: "WorkOS starter",
    description: "WorkOS AuthKit, organization sessions, and protected routes",
    provider: "workos",
    label: "WorkOS",
    route: "/integrations/workos",
    docsPath: "/docs/integrations/auth/workos",
  }),
};

function integrationTemplate(
  input: NonNullable<TemplateDetails["integration"]> & {
    title: string;
    description: string;
  },
): TemplateDetails {
  return {
    title: input.title,
    description: input.description,
    instructions: [],
    integration: {
      provider: input.provider,
      label: input.label,
      route: input.route,
      docsPath: input.docsPath,
    },
  };
}

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";
export type RendererName = "react" | "solid";

export interface PackageManager {
  name: PackageManagerName;
  version?: string;
}

export async function createApp(projectName?: string, options: CreateAppOptions = {}) {
  showBanner();

  const templates = await getAvailableTemplates();
  if (templates.length === 0) {
    logger.error("No templates are available in this package.");
    process.exit(1);
  }

  if (options.listTemplates) {
    logger.info("Available templates");
    for (const template of templates) {
      const details = templateDetails[template];
      logger.info(`  ${template.padEnd(14)} ${details?.description ?? ""}`.trimEnd());
    }
    return;
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
      choices: templates.map((name) => {
        const details = templateDetails[name];
        return {
          title: details?.title ?? prettifyTemplateName(name),
          value: name,
          description: details?.description,
        };
      }),
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

  let renderer = options.renderer?.toLowerCase() as RendererName | undefined;
  if (renderer && renderer !== "react" && renderer !== "solid") {
    logger.error(`Unknown renderer "${options.renderer}". Available: "react", "solid".`);
    process.exit(1);
  }

  // Preserve React for every existing command. The renderer chooser is shown
  // during the fully interactive basic flow, while --renderer enables CI and
  // scripted scaffolding without introducing another prompt.
  if (!renderer && !options.template && template === "basic") {
    const response = await prompts({
      type: "select",
      name: "renderer",
      message: "Which rendering library would you like to use?",
      choices: [
        {
          title: "React",
          value: "react",
          description: "The default FARMJS renderer",
        },
        {
          title: "Solid",
          value: "solid",
          description: "Fine-grained reactivity with Solid",
        },
      ],
      initial: 0,
    });
    if (!response.renderer) {
      logger.error("Operation cancelled.");
      process.exit(1);
    }
    renderer = response.renderer;
  }
  renderer ||= "react";

  if (renderer === "solid" && template !== "basic") {
    logger.error(
      `The "${template}" integration starter currently targets React. Use --template basic with --renderer solid.`,
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
  const packageManager = detectPackageManager();
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

  logger.info(`Creating FARMJS app in ${projectPath}`);

  await fs.mkdir(projectPath, { recursive: true });

  const integrationResult = await copyTemplate(template!, projectPath, useTypeScript!, renderer);

  await updatePackageJson(projectPath, projectName!, packageManager);

  logger.success(`🚜 Created ${projectName}`);

  if (!options.skipInstall) {
    logger.info(`Installing dependencies with ${packageManager.name}...`);
    await installDependencies(projectPath, packageManager);
    logger.success("Dependencies installed");
  }

  logger.info("");
  logger.info("Next steps");
  logger.info(`  cd ${projectName}`);
  if (options.skipInstall) {
    logger.info(`  ${packageManager.name} install`);
  }
  logger.info(`  ${getDevCommand(packageManager.name)}`);
  logger.info("");
  for (const instruction of templateDetails[template!]?.instructions ?? []) {
    logger.info(instruction);
  }
  if (integrationResult) {
    const details = templateDetails[template!].integration!;
    logger.info(`Open ${details.route} for the ${details.label} starter.`);
    if (integrationResult.env.length) {
      logger.info("Copy .env.example to .env.local and add your provider credentials.");
    }
    for (const note of integrationResult.notes) {
      logger.info(note);
    }
  }
}

async function copyTemplate(
  template: string,
  projectPath: string,
  useTypeScript: boolean,
  renderer: RendererName,
): Promise<AddFarmIntegrationResult | undefined> {
  const details = templateDetails[template];
  const templatePath = path.join(
    __dirname,
    "..",
    "templates",
    details?.integration ? "basic" : template,
  );

  // Copy base template files
  await copyDir(templatePath, projectPath);

  // If TypeScript is requested, copy TS-specific files
  if (useTypeScript) {
    const tsTemplatePath = path.join(__dirname, "..", "templates", "_typescript");
    if (await dirExists(tsTemplatePath)) {
      await copyDir(tsTemplatePath, projectPath);
    }
  }

  if (renderer === "solid") {
    const rendererTemplatePath = path.join(__dirname, "..", "templates", "_renderers", "solid");
    await copyDir(rendererTemplatePath, projectPath);
  }

  if (!details?.integration) {
    return undefined;
  }

  const result = await addFarmIntegration({
    root: projectPath,
    provider: details.integration.provider,
    ui: true,
  });
  await writeEnvironmentExample(projectPath, result.env);
  await writeIntegrationHomePage(projectPath, details.integration, result.env.length > 0);
  await writeIntegrationReadme(projectPath, details.integration, result.env);
  return result;
}

async function writeEnvironmentExample(projectPath: string, keys: string[]) {
  if (keys.length === 0) {
    return;
  }

  const envPath = path.join(projectPath, ".env.example");
  let current = "";
  try {
    current = await fs.readFile(envPath, "utf8");
  } catch {
    // The provider has no setup-owned environment file yet.
  }

  const existingKeys = new Set(
    current
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter((key): key is string => Boolean(key)),
  );
  const additions = keys
    .filter((key) => !existingKeys.has(key))
    .map((key) => `${key}=${environmentExampleValue(key)}`);

  if (additions.length > 0) {
    await fs.writeFile(
      envPath,
      `${current.trimEnd()}${current.trim() ? "\n" : ""}${additions.join("\n")}\n`,
      "utf8",
    );
  }
}

function environmentExampleValue(key: string) {
  if (key === "APP_BASE_URL") {
    return "http://localhost:3000";
  }
  if (key === "AUTH_SECRET") {
    return "replace-with-at-least-32-random-characters";
  }
  if (key === "UNKEY_BASE_URL") {
    return "https://api.unkey.com";
  }
  return "";
}

async function writeIntegrationHomePage(
  projectPath: string,
  integration: NonNullable<TemplateDetails["integration"]>,
  hasEnvironment: boolean,
) {
  const commands = [...(hasEnvironment ? ["cp .env.example .env.local"] : []), "pnpm dev"];
  const commandRows = commands
    .map(
      (command, index) => `            <div className="command-row">
              <span>${String(index + 1).padStart(2, "0")}</span>
              <code>${command}</code>
            </div>`,
    )
    .join("\n");
  const source = `import { ResourceLinks } from "../components/resource-links";

export default function HomePage() {
  return (
    <main className="landing-main">
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow-row">
            <span>00</span>
            <span>FARMJS / ${integration.label} starter</span>
          </div>

          <h1>
            Start at <code>${integration.route}</code>.
          </h1>

          <div className="command-list" aria-label="Getting started commands">
${commandRows}
          </div>

          <ResourceLinks
            className="resource-links"
            primary={{ href: "${integration.route}", label: "Get started" }}
          />
        </div>
      </section>
    </main>
  );
}
`;

  await fs.writeFile(path.join(projectPath, "src", "app", "page.tsx"), source, "utf8");
}

async function writeIntegrationReadme(
  projectPath: string,
  integration: NonNullable<TemplateDetails["integration"]>,
  env: string[],
) {
  const environmentSetup = env.length
    ? `cp .env.example .env.local\n# Add values for: ${env.join(", ")}\n`
    : "";
  const wiring =
    integration.provider === "ai"
      ? "The AI route lives in `src/app/api/chat/route.ts` and its local UI lives under `src/components/farm`."
      : "The provider wiring lives in `src/lib/integrations` and is registered from `farm.config.ts`.";
  const source = `# FARMJS ${integration.label} Starter

## Getting started

\`\`\`bash
pnpm install
${environmentSetup}pnpm dev
\`\`\`

Open [${integration.route}](http://localhost:3000${integration.route}) for the integration UI.

${wiring}
See the [${integration.label} integration guide](https://farm.js.dev${integration.docsPath}) for provider setup and production guidance.
`;

  await fs.writeFile(path.join(projectPath, "README.md"), source, "utf8");
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
  const templateOrder = Object.keys(templateDetails);
  const directoryTemplates = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
  const generatedTemplates = Object.entries(templateDetails)
    .filter(([, details]) => Boolean(details.integration))
    .map(([name]) => name);

  return [...new Set([...directoryTemplates, ...generatedTemplates])].sort((left, right) => {
    const leftIndex = templateOrder.indexOf(left);
    const rightIndex = templateOrder.indexOf(right);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return normalizedLeft - normalizedRight || left.localeCompare(right);
  });
}

async function updatePackageJson(
  projectPath: string,
  projectName: string,
  packageManager: PackageManager,
) {
  const packageJsonPath = path.join(projectPath, "package.json");

  try {
    const content = await fs.readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);

    packageJson.name = projectName;
    if (packageManager.version) {
      packageJson.packageManager = `${packageManager.name}@${packageManager.version}`;
    }

    await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  } catch {
    logger.warn("Could not update package.json");
  }
}

export function detectPackageManager(
  userAgent = process.env.npm_config_user_agent,
): PackageManager {
  const match = userAgent?.match(/^(npm|pnpm|yarn|bun)\/([^\s]+)/);
  if (!match) {
    return { name: "pnpm" };
  }

  const [, name, version] = match;
  return {
    name: name as PackageManagerName,
    version: version === "?" ? undefined : version,
  };
}

export function installDependencies(
  projectPath: string,
  packageManager: PackageManager,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command =
      process.platform === "win32" ? `${packageManager.name}.cmd` : packageManager.name;
    const child = spawn(command, ["install"], {
      cwd: projectPath,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      reject(new Error(`${packageManager.name} install failed with ${reason}.`));
    });
  });
}

function getDevCommand(packageManager: PackageManagerName) {
  if (packageManager === "npm" || packageManager === "bun") {
    return `${packageManager} run dev`;
  }
  return `${packageManager} dev`;
}
