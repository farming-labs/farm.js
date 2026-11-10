/**
 * Build-time scan for route-level cron options. A `cronRoute(route, { schedule, ... })` call in a
 * route file is a cron job, equivalent to a `cron` config entry. The scheduling fields are read
 * statically from the source (AST, no route-module evaluation), the same reason the config path
 * exists, so they must be literals: anything computed fails the build with the file named.
 * Scanned jobs merge with `cron` config into one job list for the manifest, deployment outputs,
 * `farm cron list|run`, and `farm dev --cron`.
 */
import type {
  FarmCronInputValue,
  FarmCronJob,
  FarmCronResolvedConfig,
  FarmCronUserConfig,
} from "./cron";
import { FARM_CRON_NAME_SEGMENT_PATTERN, normalizeCronExpression, resolveCronConfig } from "./cron";

export interface FarmCronScannedJob extends FarmCronJob {
  /** Absolute path of the route file that declared the job, for error messages. */
  filePath: string;
  enabled: boolean;
}

type Node = { type: string; [key: string]: any };

const SCANNED_OPTION_KEYS = [
  "schedule",
  "name",
  "description",
  "input",
  "timeoutMs",
  "enabled",
] as const;

const LANGS: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ts: "ts",
  tsx: "tsx",
  js: "jsx",
  jsx: "jsx",
};

// Loaded on the first route file that names cronRoute rather than imported, so loading core
// (a production server does, through farm.config) never loads the native parser.
let parseAst: (typeof import("rolldown/parseAst"))["parseAst"] | undefined;

async function loadParseAst(): Promise<typeof parseAst & {}> {
  if (!parseAst) {
    const { createRequire } = await import("node:module");
    parseAst = (
      createRequire(typeof __filename === "string" ? __filename : import.meta.url)(
        "rolldown/parseAst",
      ) as typeof import("rolldown/parseAst")
    ).parseAst;
  }
  return parseAst;
}

function unwrap(node: Node): Node {
  while (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "ParenthesizedExpression"
  ) {
    node = node.expression;
  }
  return node;
}

/**
 * Every node in the program. Rolldown's ESTree nodes carry no parent references, so the walk
 * terminates.
 */
function* walkNodes(value: unknown): Generator<Node> {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) yield* walkNodes(item);
    return;
  }
  const node = value as Node;
  if (typeof node.type === "string") yield node;
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") {
      continue;
    }
    yield* walkNodes(node[key]);
  }
}

function notLiteral(file: string, key: string): never {
  throw new TypeError(
    `The \`${key}\` option of cronRoute() in ${file} is not a literal. The build reads scheduling options from the source without running the module, so write \`${key}\` out literally or move the job to the \`cron\` config in farm.config.ts.`,
  );
}

/** A literal JSON value; anything computed fails the build naming the file and the option. */
function literalValue(node: Node | null | undefined, file: string, key: string): unknown {
  if (!node) notLiteral(file, key);
  switch (node.type) {
    case "Literal":
      if (node.regex || typeof node.value === "bigint") notLiteral(file, key);
      return node.value;
    case "TemplateLiteral":
      if (node.expressions.length > 0) notLiteral(file, key);
      return node.quasis[0]?.value?.cooked ?? notLiteral(file, key);
    case "UnaryExpression":
      if (
        node.operator === "-" &&
        node.argument.type === "Literal" &&
        typeof node.argument.value === "number"
      ) {
        return -node.argument.value;
      }
      notLiteral(file, key);
      break;
    case "ArrayExpression": {
      const items: unknown[] = [];
      for (const element of node.elements as Array<Node | null>) {
        if (!element || element.type === "SpreadElement") notLiteral(file, key);
        items.push(literalValue(unwrap(element), file, key));
      }
      return items;
    }
    case "ObjectExpression": {
      const object: Record<string, unknown> = {};
      for (const property of node.properties as Node[]) {
        if (property.type !== "Property" || property.computed || property.kind !== "init") {
          notLiteral(file, key);
        }
        const propertyKey =
          property.key.type === "Identifier" ? property.key.name : property.key.value;
        if (typeof propertyKey !== "string" || propertyKey === "__proto__") notLiteral(file, key);
        object[propertyKey] = literalValue(unwrap(property.value), file, key);
      }
      return object;
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "ParenthesizedExpression":
      return literalValue(node.expression, file, key);
  }
  notLiteral(file, key);
}

function optionProperty(object: Node, name: string): Node | undefined {
  return (object.properties as Node[]).find(
    (entry) =>
      entry.type === "Property" &&
      !entry.computed &&
      (entry.key.name === name || entry.key.value === name),
  )?.value;
}

/** Local names bound to `cronRoute` by an import declaration; aliases count, locals do not. */
function cronRouteLocalNames(program: Node): Set<string> {
  const locals = new Set<string>();
  for (const statement of program.body as Node[]) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers as Node[]) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = specifier.imported?.name ?? specifier.imported?.value;
      if (imported === "cronRoute") locals.add(specifier.local.name);
    }
  }
  return locals;
}

function scannedJobFromOptions(
  optionsNode: Node,
  file: string,
  routePath: string,
): FarmCronScannedJob | null {
  const scheduleNode = optionProperty(optionsNode, "schedule");
  if (!scheduleNode) return null;

  if ((optionsNode.properties as Node[]).some((entry) => entry.type === "SpreadElement")) {
    throw new TypeError(
      `The cronRoute() options in ${file} spread another object next to \`schedule\`, so the build cannot read the job statically. Write every scheduling option literally in the call.`,
    );
  }

  const read = (key: (typeof SCANNED_OPTION_KEYS)[number]): unknown => {
    const node = optionProperty(optionsNode, key);
    return node === undefined ? undefined : literalValue(unwrap(node), file, key);
  };

  const name = readScannedName(read("name"), file, routePath);
  const schedule = readScannedSchedule(read("schedule"), file, name);
  const description = read("description");
  if (description !== undefined && typeof description !== "string") {
    throw new TypeError(
      `The \`description\` option of cronRoute() in ${file} must be a string literal.`,
    );
  }
  const timeoutMs = read("timeoutMs");
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
  ) {
    throw new TypeError(
      `The \`timeoutMs\` option of cronRoute() in ${file} must be a positive number literal in milliseconds.`,
    );
  }
  const enabled = read("enabled");
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new TypeError(
      `The \`enabled\` option of cronRoute() in ${file} must be \`true\` or \`false\`.`,
    );
  }
  const input = read("input") as FarmCronInputValue | undefined;

  return {
    name,
    schedule,
    path: routePath,
    ...(typeof description === "string" && description.trim()
      ? { description: description.trim() }
      : {}),
    ...(input !== undefined ? { input } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    filePath: file,
    enabled: enabled !== false,
  };
}

function readScannedName(value: unknown, file: string, routePath: string): string {
  if (value === undefined) {
    const defaultName = routePath === "/api" ? "" : routePath.slice("/api/".length);
    if (!defaultName) {
      throw new TypeError(
        `The scheduled cronRoute() in ${file} sits at the \`/api\` root, which has no default job name. Set the \`name\` option.`,
      );
    }
    return defaultName;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(
      `The \`name\` option of cronRoute() in ${file} must be a non-empty string literal.`,
    );
  }
  if (!value.split("/").every((segment) => FARM_CRON_NAME_SEGMENT_PATTERN.test(segment))) {
    throw new TypeError(
      `The \`name\` option ${JSON.stringify(value)} of cronRoute() in ${file} is invalid. Each "/"-separated segment must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  return value;
}

function readScannedSchedule(value: unknown, file: string, name: string): string[] {
  const raw = Array.isArray(value) ? value : [value];
  if (raw.length === 0) {
    throw new TypeError(
      `The \`schedule\` option of cronRoute() in ${file} must list at least one cron expression.`,
    );
  }
  try {
    return [...new Set(raw.map((entry) => normalizeCronExpression(name, entry)))];
  } catch (error) {
    throw new TypeError(`${(error as Error).message} (from the cronRoute() options in ${file})`);
  }
}

/**
 * The cron jobs declared by `cronRoute()` options under `<srcDir>/app/api`. The route path comes
 * from the file location, the same mapping API route discovery uses, so dynamic segments are a
 * build error: a scheduler cannot fill route params.
 */
export async function scanFarmCronRouteJobs(options: {
  root: string;
  srcDir?: string;
}): Promise<FarmCronScannedJob[]> {
  const [path, fs] = await Promise.all([import("node:path"), import("node:fs/promises")]);
  const apiDir = path.join(options.root, options.srcDir || "src", "app", "api");
  try {
    if (!(await fs.stat(apiDir)).isDirectory()) return [];
  } catch {
    // No api directory: a production runtime or an app without API routes has nothing to scan.
    return [];
  }

  const { glob } = await import("tinyglobby");
  const files = (
    await glob("**/route.{ts,tsx,js,jsx}", {
      cwd: apiDir,
      absolute: true,
      expandDirectories: false,
    })
  ).sort();

  const jobs: FarmCronScannedJob[] = [];
  const byName = new Map<string, string>();
  for (const file of files) {
    const code = await fs.readFile(file, "utf8");
    if (!code.includes("cronRoute")) continue;

    const parse = await loadParseAst();
    const lang = LANGS[path.extname(file).slice(1)] ?? "tsx";
    let program: Node;
    try {
      program = parse(code, { lang }) as unknown as Node;
    } catch (error) {
      throw new TypeError(
        `The route file ${file} could not be parsed while reading its cronRoute() schedule: ${(error as Error).message}`,
      );
    }

    const locals = cronRouteLocalNames(program);
    if (locals.size === 0) continue;

    const relativeDir = path.relative(apiDir, path.dirname(file)).split(path.sep).join("/");
    const routePath = relativeDir === "" || relativeDir === "." ? "/api" : `/api/${relativeDir}`;

    for (const node of walkNodes(program)) {
      if (
        node.type !== "CallExpression" ||
        node.callee?.type !== "Identifier" ||
        !locals.has(node.callee.name)
      ) {
        continue;
      }
      const optionsArgument = node.arguments?.[1] as Node | undefined;
      if (!optionsArgument || optionsArgument.type === "SpreadElement") continue;
      const optionsNode = unwrap(optionsArgument);
      if (optionsNode.type !== "ObjectExpression") continue;

      const job = scannedJobFromOptions(optionsNode, file, routePath);
      if (!job) continue;

      if (/[[\]]/.test(routePath)) {
        throw new TypeError(
          `The scheduled cronRoute() in ${file} sits under a dynamic segment, and a scheduler cannot fill route params. Move the schedule to a static route.`,
        );
      }
      const existing = byName.get(job.name);
      if (existing !== undefined) {
        throw new TypeError(
          `Farm cron job ${JSON.stringify(job.name)} is defined twice: in ${existing} and in ${file}. Rename or remove one of them.`,
        );
      }
      byName.set(job.name, file);
      jobs.push(job);
    }
  }
  return jobs;
}

/**
 * One job list from `cron` config and scanned route options. A job name defined in both places is
 * an error naming both locations. Scanned `enabled: false` jobs are dropped here, matching how a
 * disabled config entry resolves today.
 */
export function mergeFarmCronJobs(
  config: FarmCronResolvedConfig,
  scanned: FarmCronScannedJob[],
): FarmCronResolvedConfig {
  const configNames = new Set(config.jobs.map((job) => job.name));
  const jobs = [...config.jobs];
  for (const scannedJob of scanned) {
    if (configNames.has(scannedJob.name)) {
      throw new TypeError(
        `Farm cron job ${JSON.stringify(scannedJob.name)} is defined twice: in the \`cron\` config in farm.config.ts and in ${scannedJob.filePath}. Rename or remove one of them.`,
      );
    }
    if (!scannedJob.enabled) continue;
    const { filePath: _filePath, enabled: _enabled, ...job } = scannedJob;
    jobs.push(job);
  }
  if (jobs.length === config.jobs.length) return config;
  return { ...config, enabled: jobs.length > 0, jobs };
}

/**
 * The project's full cron configuration: `cron` config entries plus route-level `cronRoute()`
 * schedules, resolved once where configuration resolves. An already-resolved config passes
 * through unchanged, so re-resolution never scans or merges twice. `cron: false` turns cron off
 * entirely, route-level schedules included.
 */
export async function resolveProjectCronJobs(options: {
  root?: string;
  srcDir?: string;
  cron?: FarmCronUserConfig | FarmCronResolvedConfig | false;
}): Promise<FarmCronResolvedConfig> {
  const resolved = resolveCronConfig(options.cron);
  if (resolved === options.cron || options.cron === false) return resolved;
  const scanned = await scanFarmCronRouteJobs({
    root: options.root || process.cwd(),
    srcDir: options.srcDir,
  });
  return mergeFarmCronJobs(resolved, scanned);
}
