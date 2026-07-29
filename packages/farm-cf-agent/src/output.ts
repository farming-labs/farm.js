import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { normalizeAgentRoutePrefix } from "@farm.js/core/agent-runtime";

const GENERATED_CONFIG_NAME = ".farm-cf-agent.wrangler.jsonc";

export interface CloudflareAgentOutputOptions {
  root: string;
  outputDir: string;
  config: string;
  routePrefix: string;
  environment?: string;
}

export interface CloudflareAgentDeployMetadata {
  version: 1;
  provider: "cloudflare-agents";
  config: string;
  environment?: string;
}

export interface CloudflareAgentOutput {
  wrapperPath: string;
  configPath: string;
  metadataPath: string;
}

type JsonObject = Record<string, unknown>;

/** Compose Farm's Cloudflare module output with a Cloudflare Agents Worker. */
export async function writeCloudflareAgentOutput(
  options: CloudflareAgentOutputOptions,
): Promise<CloudflareAgentOutput> {
  const root = resolve(options.root);
  const outputDir = resolve(root, options.outputDir);
  const configPath = resolve(root, options.config);
  assertInsideRoot(root, configPath, "Wrangler config");

  const configDirectory = dirname(configPath);
  const config = await readWranglerConfig(configPath);
  const agentEntryValue = config.main;
  if (typeof agentEntryValue !== "string" || !agentEntryValue.trim()) {
    throw new Error(`${configPath} must define a non-empty Wrangler main entry.`);
  }
  if (config.no_bundle === true) {
    throw new Error("@farm.js/cf-agent requires Wrangler bundling; remove no_bundle: true.");
  }

  const agentEntry = resolve(configDirectory, agentEntryValue);
  const farmEntry = join(outputDir, "server", "index.mjs");
  const publicDirectory = join(outputDir, "public");
  await assertFile(agentEntry, "Cloudflare agent entry");
  await assertFile(farmEntry, "Farm Cloudflare module entry");
  await assertDirectory(publicDirectory, "Farm public output");

  const generatedDirectory = join(root, ".farm", "cf-agent");
  const wrapperPath = join(generatedDirectory, "worker.mjs");
  const generatedConfigPath = join(configDirectory, GENERATED_CONFIG_NAME);
  const metadataPath = join(generatedDirectory, "deploy.json");
  await mkdir(generatedDirectory, { recursive: true });

  const routePrefix = normalizeAgentRoutePrefix(options.routePrefix);
  await writeFile(
    wrapperPath,
    createCombinedWorkerSource({
      wrapperPath,
      farmEntry,
      agentEntry,
      routePrefix,
    }),
  );

  const generatedConfig = createGeneratedWranglerConfig({
    config,
    configDirectory,
    wrapperPath,
    publicDirectory,
    environment: options.environment,
  });
  await writeFile(generatedConfigPath, `${JSON.stringify(generatedConfig, null, 2)}\n`);

  const metadata: CloudflareAgentDeployMetadata = {
    version: 1,
    provider: "cloudflare-agents",
    config: toRootRelativePath(root, generatedConfigPath),
    ...(options.environment ? { environment: options.environment } : {}),
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  return {
    wrapperPath,
    configPath: generatedConfigPath,
    metadataPath,
  };
}

function createCombinedWorkerSource(input: {
  wrapperPath: string;
  farmEntry: string;
  agentEntry: string;
  routePrefix: string;
}): string {
  const farmSpecifier = JSON.stringify(toImportSpecifier(input.wrapperPath, input.farmEntry));
  const agentSpecifier = JSON.stringify(toImportSpecifier(input.wrapperPath, input.agentEntry));
  const routePrefix = JSON.stringify(input.routePrefix);

  return `import farmWorker from ${farmSpecifier};
import agentWorker from ${agentSpecifier};
export * from ${agentSpecifier};

const agentRoutePrefix = ${routePrefix};

function callFetch(worker, request, env, context, label) {
  const handler = typeof worker === "function" ? worker : worker?.fetch;
  if (typeof handler !== "function") {
    throw new TypeError(label + " does not export a fetch handler.");
  }
  return handler.call(worker, request, env, context);
}

const worker = {
  ...agentWorker,
  ...farmWorker,
  fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;
    if (pathname === agentRoutePrefix || pathname.startsWith(agentRoutePrefix + "/")) {
      return callFetch(agentWorker, request, env, context, "Cloudflare agent Worker");
    }
    return callFetch(farmWorker, request, env, context, "Farm Worker");
  },
};

export default worker;
`;
}

function createGeneratedWranglerConfig(input: {
  config: JsonObject;
  configDirectory: string;
  wrapperPath: string;
  publicDirectory: string;
  environment?: string;
}): JsonObject {
  const { $schema: _schema, ...config } = input.config;
  const assets = readObject(config.assets, "Wrangler assets");
  const generated: JsonObject = {
    ...config,
    main: toConfigRelativePath(input.configDirectory, input.wrapperPath),
    compatibility_flags: withNodeCompatibility(config.compatibility_flags),
    assets: {
      ...assets,
      directory: toConfigRelativePath(input.configDirectory, input.publicDirectory),
    },
  };

  if (input.environment) {
    const environments = readObject(config.env, "Wrangler env");
    const selected = readObject(
      environments[input.environment],
      `Wrangler env.${input.environment}`,
    );
    generated.env = {
      ...environments,
      [input.environment]: {
        ...selected,
        compatibility_flags: withNodeCompatibility(
          selected.compatibility_flags ?? config.compatibility_flags,
        ),
        assets: {
          ...readObject(
            selected.assets ?? config.assets,
            `Wrangler env.${input.environment}.assets`,
          ),
          directory: toConfigRelativePath(input.configDirectory, input.publicDirectory),
        },
      },
    };
  }

  return generated;
}

async function readWranglerConfig(configPath: string): Promise<JsonObject> {
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch {
    throw new Error(`Wrangler config was not found at ${configPath}.`);
  }

  const errors: ParseError[] = [];
  const value = parse(source, errors, { allowTrailingComma: true });
  if (errors.length) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");
    throw new Error(`Unable to parse ${basename(configPath)}: ${details}.`);
  }
  if (!isObject(value)) {
    throw new Error(`${configPath} must contain a Wrangler configuration object.`);
  }
  return value;
}

function withNodeCompatibility(value: unknown): string[] {
  if (value === undefined) return ["nodejs_compat"];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error("Wrangler compatibility_flags must be an array of strings.");
  }
  return value.includes("nodejs_compat") ? [...value] : [...value, "nodejs_compat"];
}

function readObject(value: unknown, label: string): JsonObject {
  if (value === undefined) return {};
  if (!isObject(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toImportSpecifier(fromFile: string, target: string): string {
  const value = normalizePath(relative(dirname(fromFile), target));
  return hasRelativePrefix(value) ? value : `./${value}`;
}

function toConfigRelativePath(configDirectory: string, target: string): string {
  const value = normalizePath(relative(configDirectory, target));
  return hasRelativePrefix(value) ? value : `./${value}`;
}

function toRootRelativePath(root: string, target: string): string {
  return normalizePath(relative(root, target));
}

function normalizePath(value: string): string {
  return sep === "/" ? value : value.split(sep).join("/");
}

function hasRelativePrefix(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../");
}

function assertInsideRoot(root: string, target: string, label: string): void {
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} must be inside the Farm project root.`);
  }
}

async function assertFile(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} was not found at ${path}.`);
  }
}

async function assertDirectory(path: string, label: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error();
  } catch {
    throw new Error(`${label} was not found at ${path}.`);
  }
}
