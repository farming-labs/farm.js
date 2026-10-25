import { loadConfig, logger } from "@farm.js/core/internal/cli-runtime";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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

  addSharedFarmFiles(root, packageJson, plan, options);
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
  const sourceAppDir = existsSync(rootAppDir)
    ? rootAppDir
    : existsSync(srcAppDir)
      ? srcAppDir
      : null;

  if (!sourceAppDir) {
    plan.warnings.push("No Next App Router directory found at app/ or src/app/.");
    if (existsSync(path.join(root, "pages"))) {
      plan.manual.push(
        "Pages Router files in pages/ need manual conversion to src/app/**/page.tsx.",
      );
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

  // Code outside the App Router (components/, lib/, hooks/, ...) imports next/link and
  // friends too. Rewrite the supported imports in place, or the routes keep loading Next.js
  // through the modules they import.
  for (const file of await collectSharedSourceFiles(root, sourceAppDir)) {
    const content = await readFile(file, "utf8");
    const transformed = transformNextContent(content);
    const relative = path.relative(root, file);
    collectNextManualNotes(relative, transformed, plan);
    if (transformed === content) continue;
    await addWriteFileOperation(plan, {
      root,
      source: file,
      target: file,
      content: transformed,
      description: `Update Next imports in ${toPosix(relative)}`,
      force: options.force,
    });
  }

  const sourceAlias = readTsconfigSourceAlias(root);
  if (sourceAlias) {
    plan.manual.push(
      `tsconfig.json maps @/* to ${sourceAlias}, but Farm resolves @ to src/. Move the folders it points at under src/ and map @/* to ./src/*, or set an @ alias in farm.config.ts (vite.resolve.alias).`,
    );
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
      "Review migrated middleware for next/server APIs; Farm middleware uses @farm.js/core/middleware.",
    );
  }

  if (
    [
      "next.config.js",
      "next.config.mjs",
      "next.config.cjs",
      "next.config.ts",
      "next.config.mts",
    ].some((file) => existsSync(path.join(root, file)))
  ) {
    plan.manual.push(
      "Review next.config.* and move equivalent settings into farm.config.ts or Vite config.",
    );
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
      plan.manual.push(
        `Review ${toPosix(path.relative(root, file))}; root routes and route trees are not copied automatically.`,
      );
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
  options: { force?: boolean },
) {
  const farmConfigPath = ["farm.config.ts", "farm.config.mts", "farm.config.js", "farm.config.mjs"]
    .map((file) => path.join(root, file))
    .find((file) => existsSync(file));

  if (!farmConfigPath) {
    const output = `import { defineConfig } from "@farm.js/core";

export default defineConfig({});
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
  // Only scaffold a stub layout when nothing produces one. A Next app with a
  // root app/layout.tsx already queued a copy to this exact path; the file does
  // not exist at plan time, so an existsSync check alone adds the stub too, and
  // since operations run in order the stub overwrites the user's copied layout.
  const layoutAlreadyPlanned = plan.operations.some((operation) => operation.path === layoutPath);
  if (!existsSync(layoutPath) && !layoutAlreadyPlanned) {
    plan.operations.push({
      kind: "write-file",
      path: layoutPath,
      description: "Create a minimal root layout",
      content: `import type { LayoutProps } from "@farm.js/core";

export default function Layout({ children }: LayoutProps) {
  return <>{children}</>;
}
`,
      skipped: false,
    });
  }

  if (!packageJson) {
    plan.warnings.push("No package.json found; add @farm.js/core and @farm.js/cli manually.");
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
      logger.warn(
        `Skipped ${toPosix(path.relative(plan.root, operation.path))}: ${operation.reason}`,
      );
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
  if (
    existsSync(path.join(root, "next.config.js")) ||
    existsSync(path.join(root, "next.config.mjs"))
  ) {
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

// Build output, static assets, and the Pages Router live at the project root (pages/ also
// under src/). Deeper folders with these names, such as lib/build/, are ordinary source.
const SHARED_SOURCE_ROOT_SKIP = ["dist", "build", "out", "coverage", "public", "pages"];

/** Code files outside the App Router, for import rewrites. Content files are left alone. */
async function collectSharedSourceFiles(root: string, appDir: string): Promise<string[]> {
  const skipped = new Set([
    path.resolve(appDir),
    path.resolve(root, "src", "app"),
    path.resolve(root, "src", "pages"),
    ...SHARED_SOURCE_ROOT_SKIP.map((name) => path.resolve(root, name)),
  ]);
  const files: string[] = [];
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const fullPath = path.join(dir, entry);
      if (skipped.has(path.resolve(fullPath))) continue;
      // lstat: a symlink can loop back to a parent (ELOOP) or point outside the project,
      // where the migration must not write. Files it links to inside the root are visited
      // at their real path.
      const info = await lstat(fullPath);
      if (info.isDirectory()) await visit(fullPath);
      else if (info.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(entry)) {
        files.push(fullPath);
      }
    }
  };
  await visit(root);
  return files.sort();
}

/** The `@/*` target from tsconfig.json when it points somewhere other than src/. */
function readTsconfigSourceAlias(root: string): string | null {
  const tsconfigPath = path.join(root, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return null;
  try {
    const raw = stripJsonComments(readFileSync(tsconfigPath, "utf8")).replace(/,(\s*[}\]])/g, "$1");
    const compilerOptions = JSON.parse(raw)?.compilerOptions;
    const target = compilerOptions?.paths?.["@/*"]?.[0];
    if (typeof target !== "string") return null;
    const prefix = target === "*" ? "." : target.endsWith("/*") ? target.slice(0, -2) : null;
    if (prefix === null) return target;
    // `paths` resolve against `baseUrl` when it is set, as TypeScript does.
    const baseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : ".";
    const directory = path.resolve(root, baseUrl, prefix);
    if (directory === path.resolve(root, "src")) return null;
    const relative = toPosix(path.relative(root, directory));
    if (!relative) return "./*";
    return relative.startsWith("..") ? `${relative}/*` : `./${relative}/*`;
  } catch {
    return null;
  }
}

/**
 * Drop `//` and block comments outside string literals. A regex would treat the
 * "@/*" alias and a later "include" glob as one block comment and corrupt the JSON.
 */
function stripJsonComments(source: string): string {
  let output = "";
  let inString = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      output += char;
      if (char === "\\") output += source[++index] ?? "";
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index++;
      output += "\n";
    } else if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 1;
    } else {
      output += char;
    }
  }
  return output;
}

// What @farm.js/core/navigation and @farm.js/core/headers export (values and types). An import
// from next/navigation or next/headers is rewritten only when every name it takes is here; the
// CLI tests keep these lists equal to core's entry points.
const FARM_NEXT_MODULE_EXPORTS: Record<string, { target: string; names: ReadonlySet<string> }> = {
  "next/navigation": {
    target: "@farm.js/core/navigation",
    names: new Set([
      "FarmRedirectSignal",
      "FarmRedirectStatus",
      "getFarmRedirectError",
      "isFarmNotFoundError",
      "isFarmRedirectError",
      "notFound",
      "permanentRedirect",
      "redirect",
      "usePathname",
      "useRouter",
      "useSearchParams",
    ]),
  },
  "next/headers": {
    target: "@farm.js/core/headers",
    names: new Set([
      "ReadonlyHeaders",
      "ReadonlyRequestCookies",
      "RequestCookie",
      "cookies",
      "headers",
    ]),
  },
};

const NEXT_COMPAT_STATEMENT =
  /\b(import|export)(\s+type)?(\s+[\w$\s,{}*]*?)\s*from\s*["'](next\/(?:navigation|headers))["']/g;

/** Names an import/export clause takes from `moduleId` that Farm's counterpart lacks. */
function unsupportedNextNames(moduleId: string, clause: string): string[] {
  const supported = FARM_NEXT_MODULE_EXPORTS[moduleId].names;
  const named = clause.match(/\{([^}]*)\}/);
  const outside = clause.replace(/\{[^}]*\}/, "").trim();
  const unsupported: string[] = [];
  // `* as nav`, `export *`, or a default import can reach any name, so none is verifiable.
  if (outside.includes("*")) unsupported.push("*");
  else if (outside.replace(/,/g, "").trim()) unsupported.push("default");
  for (const specifier of named?.[1].split(",") ?? []) {
    const name = specifier
      .trim()
      .replace(/^type\s+/, "")
      .split(/\s+as\s+/)[0]
      .trim();
    if (name && !supported.has(name)) unsupported.push(name);
  }
  return unsupported;
}

function transformNextContent(content: string) {
  return content
    .replace(/import\s+([A-Za-z_$][\w$]*)\s+from\s+["']next\/link["'];?/g, (_match, localName) =>
      localName === "Link"
        ? `import { Link } from "@farm.js/core/client";`
        : `import { Link as ${localName} } from "@farm.js/core/client";`,
    )
    .replace(NEXT_COMPAT_STATEMENT, (statement, keyword, typeOnly, clause, moduleId) =>
      unsupportedNextNames(moduleId, clause).length
        ? statement
        : `${keyword}${typeOnly ?? ""}${clause} from "${FARM_NEXT_MODULE_EXPORTS[moduleId].target}"`,
    );
}

function collectNextManualNotes(relative: string, content: string, plan: FrameworkMigrationPlan) {
  const file = toPosix(relative);
  const unsupportedByStatement = new Map<number, string[]>();
  for (const match of content.matchAll(NEXT_COMPAT_STATEMENT)) {
    unsupportedByStatement.set(
      match.index! + match[0].length,
      unsupportedNextNames(match[4], match[3]),
    );
  }
  for (const match of content.matchAll(/from\s*["'](next\/[^"']+)["']/g)) {
    const importId = match[1];
    const unsupported = unsupportedByStatement.get(match.index! + match[0].length);
    if (!unsupported?.length) {
      plan.manual.push(`Review ${file}; it still imports ${importId}.`);
      continue;
    }
    const names = unsupported.map((name) =>
      name === "*" ? "every name (*)" : name === "default" ? "a default export" : name,
    );
    plan.manual.push(
      `Review ${file}; it still imports ${importId} because ${FARM_NEXT_MODULE_EXPORTS[importId].target} does not export ${names.join(", ")}.`,
    );
  }
  for (const match of content.matchAll(/\b(import|require)\s*\(\s*["'](next\/[^"']+)["']\s*\)/g)) {
    plan.manual.push(
      `Review ${file}; it loads ${match[2]} with ${match[1]}(), which the migration does not rewrite.`,
    );
  }

  if (/getServerSideProps|getStaticProps|getInitialProps/.test(content)) {
    plan.manual.push(
      `Review ${toPosix(relative)}; Pages Router data functions need manual App Router/Farm conversion.`,
    );
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

function transformTanStackContent(
  content: string,
  relativeFile: string,
  plan: FrameworkMigrationPlan,
) {
  if (/Route\.use[A-Z]/.test(content) || /useLoaderData|beforeLoad|loader:/.test(content)) {
    plan.manual.push(`Review ${toPosix(relativeFile)}; it uses TanStack route runtime APIs.`);
  }

  if (/export\s+default\s+/.test(content)) return content;

  const componentName = content.match(/component\s*:\s*([A-Za-z_$][\w$]*)/)?.[1];
  if (!componentName) {
    plan.manual.push(
      `Add a default export to ${toPosix(relativeFile)}; no component: Identifier was found.`,
    );
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

  // `farm build` writes the server to .farm/.output with the farm.config.ts this migration
  // creates, the same start command new Farm projects use.
  const startScript = "node .farm/.output/server/index.mjs";
  const scriptReplacements =
    source === "next"
      ? [
          ["dev", "farm dev", /(^|\s)next\s+dev(\s|$)/],
          ["build", "farm build", /(^|\s)next\s+build(\s|$)/],
          ["start", startScript, /(^|\s)next\s+start(\s|$)/],
        ]
      : [
          ["dev", "farm dev", /(^|\s)vite(\s|$)|(^|\s)vinxi\s+dev(\s|$)/],
          ["build", "farm build", /(^|\s)vite\s+build(\s|$)|(^|\s)vinxi\s+build(\s|$)/],
          [
            "start",
            startScript,
            /(^|\s)vinxi\s+start(\s|$)|(^|\s)node\s+\.?\/?\.output\/server\/index\.mjs(\s|$)/,
          ],
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
  if (!nextPackageJson.dependencies["@farm.js/core"]) {
    nextPackageJson.dependencies["@farm.js/core"] = "latest";
    changes.push("dependencies.@farm.js/core -> latest");
  }

  nextPackageJson.devDependencies = nextPackageJson.devDependencies || {};
  if (!nextPackageJson.devDependencies["@farm.js/cli"]) {
    nextPackageJson.devDependencies["@farm.js/cli"] = "latest";
    changes.push("devDependencies.@farm.js/cli -> latest");
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
