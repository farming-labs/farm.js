import { loadConfig, logger } from "@farmjs/core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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
  source?: FarmFrameworkMigrationSource | "inspect";
  write?: boolean;
  force?: boolean;
}

interface ResolvedMigrationCommand {
  command: string;
  name: string;
  cwd: string;
  env?: Record<string, string | undefined>;
}

export type FarmFrameworkMigrationSource = "next" | "tanstack";

type MigrationOperationKind = "write-file" | "update-package";

export interface FrameworkDetection {
  source: FarmFrameworkMigrationSource;
  confidence: number;
  evidence: string[];
}

export interface FrameworkMigrationOperation {
  kind: MigrationOperationKind;
  path: string;
  description: string;
  content?: string;
  skipped?: boolean;
  reason?: string;
  changes?: string[];
}

export interface FrameworkMigrationPlan {
  source: FarmFrameworkMigrationSource;
  root: string;
  confidence: number;
  evidence: string[];
  operations: FrameworkMigrationOperation[];
  warnings: string[];
  manual: string[];
}

export async function migrateFarm(options: MigrateFarmOptions = {}) {
  const root = path.resolve(options.root || process.cwd());

  if (options.source) {
    if (options.source === "inspect") {
      const detections = await inspectFrameworkMigrations(root);
      printFrameworkInspection(root, detections);
      return detections;
    }

    if (!isFrameworkMigrationSource(options.source)) {
      throw new Error(
        `Unsupported migration source "${options.source}". Use "inspect", "next", or "tanstack".`,
      );
    }

    const plan = await createFrameworkMigrationPlan(root, options.source, {
      force: options.force,
    });
    printFrameworkMigrationPlan(plan, Boolean(options.write && !options.dryRun));

    if (!options.write || options.dryRun) {
      logger.info(`Dry run only. Re-run with "farm migrate ${options.source} --write" to apply.`);
      return plan;
    }

    await applyFrameworkMigrationPlan(plan);
    logger.success(
      `Applied ${formatOperationCount(plan.operations.filter((operation) => !operation.skipped).length)}.`,
    );
    return plan;
  }

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

function formatOperationCount(count: number) {
  return `${count} migration operation${count === 1 ? "" : "s"}`;
}

function isFrameworkMigrationSource(value: string): value is FarmFrameworkMigrationSource {
  return value === "next" || value === "tanstack";
}

export async function inspectFrameworkMigrations(root: string): Promise<FrameworkDetection[]> {
  const packageJson = await readPackageJson(root);
  const detections = [detectNext(root, packageJson), detectTanStack(root, packageJson)]
    .filter((entry): entry is FrameworkDetection => entry.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  return detections;
}

export async function createFrameworkMigrationPlan(
  root: string,
  source: FarmFrameworkMigrationSource,
  options: { force?: boolean } = {},
): Promise<FrameworkMigrationPlan> {
  const detections = await inspectFrameworkMigrations(root);
  const detection =
    detections.find((entry) => entry.source === source) ||
    ({
      source,
      confidence: 0,
      evidence: [`No ${source} markers detected.`],
    } satisfies FrameworkDetection);

  const packageJson = await readPackageJson(root);
  const plan: FrameworkMigrationPlan = {
    source,
    root,
    confidence: detection.confidence,
    evidence: detection.evidence,
    operations: [],
    warnings: [],
    manual: [],
  };

  if (source === "next") {
    await planNextMigration(root, packageJson, plan, options);
  } else {
    await planTanStackMigration(root, packageJson, plan, options);
  }

  addSharedFarmFiles(root, packageJson, plan, source, options);
  return plan;
}

async function planNextMigration(
  root: string,
  packageJson: any,
  plan: FrameworkMigrationPlan,
  options: { force?: boolean },
) {
  const rootAppDir = path.join(root, "app");
  const srcAppDir = path.join(root, "src", "app");
  const sourceAppDir = existsSync(rootAppDir) ? rootAppDir : existsSync(srcAppDir) ? srcAppDir : null;

  if (!sourceAppDir) {
    plan.warnings.push("No Next App Router directory found at app/ or src/app/.");
    if (existsSync(path.join(root, "pages"))) {
      plan.manual.push("Pages Router files in pages/ need manual conversion to src/app/**/page.tsx.");
    }
    return;
  }

  const allFiles = await collectFiles(sourceAppDir);
  const files = allFiles.filter(isMigratableTextFile);
  for (const file of allFiles) {
    if (!isMigratableTextFile(file)) {
      plan.manual.push(`Move or review non-code app asset ${toPosix(path.relative(root, file))}.`);
    }
  }

  for (const file of files) {
    const relative = path.relative(sourceAppDir, file);
    const target = path.join(srcAppDir, relative);
    const content = await readFile(file, "utf8");
    const transformed = transformNextContent(content);

    collectNextManualNotes(relative, transformed, plan);
    await addWriteFileOperation(plan, {
      root,
      source: file,
      target,
      content: transformed,
      description:
        sourceAppDir === srcAppDir
          ? `Update Next-compatible app file ${toPosix(path.join("src/app", relative))}`
          : `Copy Next App Router file to ${toPosix(path.join("src/app", relative))}`,
      force: options.force,
      allowExisting: sourceAppDir === srcAppDir,
    });
  }

  const rootMiddleware = ["middleware.ts", "middleware.tsx", "middleware.js", "middleware.jsx"]
    .map((file) => path.join(root, file))
    .find((file) => existsSync(file));

  if (rootMiddleware) {
    const extension = path.extname(rootMiddleware);
    const target = path.join(srcAppDir, `middleware${extension}`);
    await addWriteFileOperation(plan, {
      root,
      source: rootMiddleware,
      target,
      content: await readFile(rootMiddleware, "utf8"),
      description: `Copy root middleware to ${toPosix(path.join("src/app", `middleware${extension}`))}`,
      force: options.force,
    });
    plan.manual.push(
      "Review migrated middleware for next/server APIs; Farm middleware uses @farmjs/core/middleware.",
    );
  }

  if (existsSync(path.join(root, "next.config.js")) || existsSync(path.join(root, "next.config.mjs"))) {
    plan.manual.push("Review next.config.* and move equivalent settings into farm.config.ts or Vite config.");
  }

  if (packageJson) {
    const migratedPackage = createMigratedPackageJson(packageJson, "next");
    addPackageOperation(root, plan, migratedPackage);
  }
}

async function planTanStackMigration(
  root: string,
  packageJson: any,
  plan: FrameworkMigrationPlan,
  options: { force?: boolean },
) {
  const routesDir = [path.join(root, "src", "routes"), path.join(root, "routes")].find((dir) =>
    existsSync(dir),
  );

  if (!routesDir) {
    plan.warnings.push("No TanStack Router file-route directory found at src/routes/ or routes/.");
    return;
  }

  const appDir = path.join(root, "src", "app");
  const files = (await collectFiles(routesDir)).filter((file) => {
    const basename = path.basename(file);
    return (
      /\.(tsx|ts|jsx|js)$/.test(file) &&
      basename !== "routeTree.gen.ts" &&
      basename !== "routeTree.gen.tsx"
    );
  });

  for (const file of files) {
    const target = getTanStackTargetPath(routesDir, file, appDir);
    if (!target) {
      plan.manual.push(`Review ${toPosix(path.relative(root, file))}; root routes and route trees are not copied automatically.`);
      continue;
    }

    const original = await readFile(file, "utf8");
    const transformed = transformTanStackContent(original, path.relative(root, file), plan);
    await addWriteFileOperation(plan, {
      root,
      source: file,
      target,
      content: transformed,
      description: `Convert TanStack route to ${toPosix(path.relative(root, target))}`,
      force: options.force,
    });
  }

  plan.manual.push(
    "Review loaders, beforeLoad hooks, search params, and Route.use* calls; Farm page modules should move that logic into props, API routes, or server helpers.",
  );

  if (packageJson) {
    const migratedPackage = createMigratedPackageJson(packageJson, "tanstack");
    addPackageOperation(root, plan, migratedPackage);
  }
}

function addSharedFarmFiles(
  root: string,
  packageJson: any,
  plan: FrameworkMigrationPlan,
  source: FarmFrameworkMigrationSource,
  options: { force?: boolean },
) {
  const farmConfigPath = ["farm.config.ts", "farm.config.mts", "farm.config.js", "farm.config.mjs"]
    .map((file) => path.join(root, file))
    .find((file) => existsSync(file));

  if (!farmConfigPath) {
    const output =
      source === "next"
        ? `import { defineConfig } from "@farmjs/core";

export default defineConfig({
  srcDir: "src",
});
`
        : `import { defineConfig } from "@farmjs/core";

export default defineConfig({
  srcDir: "src",
});
`;

    plan.operations.push({
      kind: "write-file",
      path: path.join(root, "farm.config.ts"),
      description: "Create farm.config.ts",
      content: output,
      skipped: false,
    });
  }

  const layoutPath = path.join(root, "src", "app", "layout.tsx");
  if (!existsSync(layoutPath)) {
    plan.operations.push({
      kind: "write-file",
      path: layoutPath,
      description: "Create a minimal root layout",
      content: `import type { LayoutProps } from "@farmjs/core";

export default function Layout({ children }: LayoutProps) {
  return <>{children}</>;
}
`,
      skipped: false,
    });
  }

  if (!packageJson) {
    plan.warnings.push("No package.json found; add @farmjs/core and @farmjs/cli manually.");
  }
}

async function addWriteFileOperation(
  plan: FrameworkMigrationPlan,
  options: {
    root: string;
    source?: string;
    target: string;
    content: string;
    description: string;
    force?: boolean;
    allowExisting?: boolean;
  },
) {
  const exists = existsSync(options.target);
  const sameFile = options.source && path.resolve(options.source) === path.resolve(options.target);
  const skipped = exists && !sameFile && !options.allowExisting && !options.force;

  plan.operations.push({
    kind: "write-file",
    path: options.target,
    description: options.description,
    content: options.content,
    skipped,
    reason: skipped
      ? `${toPosix(path.relative(options.root, options.target))} already exists; pass --force to overwrite.`
      : undefined,
  });
}

function addPackageOperation(
  root: string,
  plan: FrameworkMigrationPlan,
  migrated: { packageJson: any; changes: string[] },
) {
  if (!migrated.changes.length) return;

  plan.operations.push({
    kind: "update-package",
    path: path.join(root, "package.json"),
    description: "Update package.json scripts and Farm dependencies",
    content: `${JSON.stringify(migrated.packageJson, null, 2)}\n`,
    changes: migrated.changes,
  });
}

async function applyFrameworkMigrationPlan(plan: FrameworkMigrationPlan) {
  for (const operation of plan.operations) {
    if (operation.skipped) {
      logger.warn(`Skipped ${toPosix(path.relative(plan.root, operation.path))}: ${operation.reason}`);
      continue;
    }

    if (operation.kind === "write-file" || operation.kind === "update-package") {
      await mkdir(path.dirname(operation.path), { recursive: true });
      await writeFile(operation.path, operation.content || "", "utf8");
    }
  }
}

function printFrameworkInspection(root: string, detections: FrameworkDetection[]) {
  logger.info(`Migration inspection for ${root}`);

  if (!detections.length) {
    logger.warn("No supported framework detected yet. Supported sources: next, tanstack.");
    return;
  }

  for (const detection of detections) {
    logger.info(`${detection.source}: ${detection.confidence}% confidence`);
    for (const evidence of detection.evidence) {
      logger.info(`  - ${evidence}`);
    }
  }
}

function printFrameworkMigrationPlan(plan: FrameworkMigrationPlan, willWrite: boolean) {
  logger.info(
    `${willWrite ? "Applying" : "Prepared"} ${plan.source} migration plan (${plan.confidence}% confidence):`,
  );

  for (const evidence of plan.evidence) {
    logger.info(`  evidence: ${evidence}`);
  }

  if (!plan.operations.length) {
    logger.warn("No file operations were planned.");
  } else {
    logger.info("Operations:");
    for (const operation of plan.operations) {
      const marker = operation.skipped ? "skip" : willWrite ? "write" : "plan";
      logger.info(`  [${marker}] ${operation.description}`);
      if (operation.changes?.length) {
        for (const change of operation.changes) {
          logger.info(`        - ${change}`);
        }
      }
      if (operation.reason) {
        logger.info(`        ${operation.reason}`);
      }
    }
  }

  if (plan.warnings.length) {
    logger.warn("Warnings:");
    for (const warning of unique(plan.warnings)) {
      logger.warn(`  - ${warning}`);
    }
  }

  if (plan.manual.length) {
    logger.info("Manual review:");
    for (const note of unique(plan.manual)) {
      logger.info(`  - ${note}`);
    }
  }
}

function detectNext(root: string, packageJson: any): FrameworkDetection {
  const evidence: string[] = [];
  let confidence = 0;

  if (hasPackage(packageJson, "next")) {
    confidence += 55;
    evidence.push("package.json depends on next");
  }
  if (existsSync(path.join(root, "app"))) {
    confidence += 30;
    evidence.push("app/ directory exists");
  }
  if (existsSync(path.join(root, "src", "app"))) {
    confidence += 25;
    evidence.push("src/app/ directory exists");
  }
  if (existsSync(path.join(root, "next.config.js")) || existsSync(path.join(root, "next.config.mjs"))) {
    confidence += 15;
    evidence.push("next.config.* exists");
  }
  if (existsSync(path.join(root, "pages"))) {
    confidence += 10;
    evidence.push("pages/ directory exists");
  }

  return { source: "next", confidence: Math.min(confidence, 100), evidence };
}

function detectTanStack(root: string, packageJson: any): FrameworkDetection {
  const evidence: string[] = [];
  let confidence = 0;

  if (hasPackage(packageJson, "@tanstack/react-router")) {
    confidence += 60;
    evidence.push("package.json depends on @tanstack/react-router");
  }
  if (existsSync(path.join(root, "src", "routes"))) {
    confidence += 35;
    evidence.push("src/routes/ directory exists");
  }
  if (existsSync(path.join(root, "routes"))) {
    confidence += 25;
    evidence.push("routes/ directory exists");
  }
  if (existsSync(path.join(root, "src", "routeTree.gen.ts"))) {
    confidence += 15;
    evidence.push("src/routeTree.gen.ts exists");
  }

  return { source: "tanstack", confidence: Math.min(confidence, 100), evidence };
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === ".output") continue;
    const fullPath = path.join(dir, entry);
    const info = await stat(fullPath);

    if (info.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (info.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function transformNextContent(content: string) {
  return content
    .replace(
      /import\s+([A-Za-z_$][\w$]*)\s+from\s+["']next\/link["'];?/g,
      (_match, localName) =>
        localName === "Link"
          ? `import { Link } from "@farmjs/core/client";`
          : `import { Link as ${localName} } from "@farmjs/core/client";`,
    )
    .replace(/from\s+["']next\/navigation["']/g, `from "@farmjs/core/navigation"`)
    .replace(/from\s+["']next\/headers["']/g, `from "@farmjs/core/headers"`);
}

function collectNextManualNotes(relative: string, content: string, plan: FrameworkMigrationPlan) {
  const imports = Array.from(content.matchAll(/from\s+["'](next\/[^"']+)["']/g)).map((match) => match[1]);
  for (const importId of imports) {
    plan.manual.push(`Review ${toPosix(relative)}; it still imports ${importId}.`);
  }

  if (/getServerSideProps|getStaticProps|getInitialProps/.test(content)) {
    plan.manual.push(`Review ${toPosix(relative)}; Pages Router data functions need manual App Router/Farm conversion.`);
  }
}

function isMigratableTextFile(file: string) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|md|mdx|css|json|txt)$/.test(file);
}

function getTanStackTargetPath(routesDir: string, file: string, appDir: string) {
  const relative = toPosix(path.relative(routesDir, file));
  const withoutExt = relative.replace(/\.(tsx|ts|jsx|js)$/, "");
  if (withoutExt === "__root" || withoutExt === "routeTree.gen") return null;

  const rawParts = withoutExt
    .split("/")
    .flatMap((segment) => segment.split("."))
    .filter((segment) => segment && !segment.startsWith("_"));

  if (!rawParts.length) return null;
  const isIndex = rawParts[rawParts.length - 1] === "index";
  const routeParts = (isIndex ? rawParts.slice(0, -1) : rawParts).map(convertTanStackSegment);
  return path.join(appDir, ...routeParts, "page.tsx");
}

function convertTanStackSegment(segment: string) {
  if (segment === "$") return "[...splat]";
  if (segment.startsWith("$")) return `[${segment.slice(1)}]`;
  return segment;
}

function transformTanStackContent(content: string, relativeFile: string, plan: FrameworkMigrationPlan) {
  if (/Route\.use[A-Z]/.test(content) || /useLoaderData|beforeLoad|loader:/.test(content)) {
    plan.manual.push(`Review ${toPosix(relativeFile)}; it uses TanStack route runtime APIs.`);
  }

  if (/export\s+default\s+/.test(content)) return content;

  const componentName = content.match(/component\s*:\s*([A-Za-z_$][\w$]*)/)?.[1];
  if (!componentName) {
    plan.manual.push(`Add a default export to ${toPosix(relativeFile)}; no component: Identifier was found.`);
    return content;
  }

  return `${content.trimEnd()}

export default ${componentName};
`;
}

function createMigratedPackageJson(packageJson: any, source: FarmFrameworkMigrationSource) {
  const nextPackageJson = cloneJson(packageJson);
  const changes: string[] = [];
  nextPackageJson.scripts = nextPackageJson.scripts || {};

  const scriptReplacements =
    source === "next"
      ? [
          ["dev", "farm dev", /(^|\s)next\s+dev(\s|$)/],
          ["build", "farm build", /(^|\s)next\s+build(\s|$)/],
          ["start", "node .output/server/index.mjs", /(^|\s)next\s+start(\s|$)/],
        ]
      : [
          ["dev", "farm dev", /(^|\s)vite(\s|$)|(^|\s)vinxi\s+dev(\s|$)/],
          ["build", "farm build", /(^|\s)vite\s+build(\s|$)|(^|\s)vinxi\s+build(\s|$)/],
        ];

  for (const [name, value, matcher] of scriptReplacements as [string, string, RegExp][]) {
    const existing = nextPackageJson.scripts[name];
    if (!existing || matcher.test(existing)) {
      if (existing !== value) {
        nextPackageJson.scripts[name] = value;
        changes.push(`scripts.${name} -> ${value}`);
      }
    }
  }

  nextPackageJson.dependencies = nextPackageJson.dependencies || {};
  if (!nextPackageJson.dependencies["@farmjs/core"]) {
    nextPackageJson.dependencies["@farmjs/core"] = "latest";
    changes.push("dependencies.@farmjs/core -> latest");
  }

  nextPackageJson.devDependencies = nextPackageJson.devDependencies || {};
  if (!nextPackageJson.devDependencies["@farmjs/cli"]) {
    nextPackageJson.devDependencies["@farmjs/cli"] = "latest";
    changes.push("devDependencies.@farmjs/cli -> latest");
  }

  return { packageJson: nextPackageJson, changes };
}

async function readPackageJson(root: string) {
  const packagePath = path.join(root, "package.json");
  if (!existsSync(packagePath)) return null;
  return JSON.parse(await readFile(packagePath, "utf8"));
}

function hasPackage(packageJson: any, packageName: string) {
  return Boolean(
    packageJson?.dependencies?.[packageName] ||
      packageJson?.devDependencies?.[packageName] ||
      packageJson?.peerDependencies?.[packageName],
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function toPosix(value: string) {
  return value.split(path.sep).join("/");
}
