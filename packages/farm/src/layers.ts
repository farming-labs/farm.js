import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

type EsbuildTransform = (typeof import("esbuild"))["transform"];

export type FarmLayerEntry = string;

export interface ResolvedFarmLayer {
  /** The value used in `extends`. */
  source: string;
  /** Stable name used by the `#layers/<name>` alias. */
  name: string;
  /** Absolute layer package or directory root. */
  root: string;
  /** Source directory relative to the layer root. */
  srcDir: string;
  /** Resolved layer config file when one exists. */
  configFile?: string;
}

export interface FarmSourceRoot {
  name: string;
  root: string;
  srcDir: string;
  layer: boolean;
}

export interface ResolveFarmLayersOptions {
  root: string;
  mode: "development" | "production";
}

export interface FarmLayerResolution<TConfig extends Record<string, any>> {
  config: TConfig & {
    extends?: readonly FarmLayerEntry[];
    layers: ResolvedFarmLayer[];
  };
  layers: ResolvedFarmLayer[];
}

const FARM_CORE_PACKAGE = "@farmjs/core";
const FARM_CONFIG_ENTRY = "@farmjs/core/config";
const FARM_CORE_REFERENCE_RE = /(["'])@farmjs\/core\1/g;
const FARM_CONFIG_HELPER_IMPORT_RE =
  /(?:^|\n)[\t ]*import[\t ]*\{([^{}]*)\}[\t ]*from[\t ]*(["'])@farmjs\/core\2[\t ]*;?[\t ]*(?:\n|$)/g;
const FARM_CONFIG_HELPER_SPECIFIER_RE =
  /^(?:defineConfig|defineFarmConfig)(?:\s+as\s+[$A-Z_a-z][$\w]*)?$/;

const CONFIG_FILENAMES = [
  "farm.config.ts",
  "farm.config.tsx",
  "farm.config.mts",
  "farm.config.cts",
  "farm.config.js",
  "farm.config.jsx",
  "farm.config.mjs",
  "farm.config.cjs",
  "config.ts",
  "config.tsx",
  "config.mts",
  "config.cts",
  "config.js",
  "config.jsx",
  "config.mjs",
  "config.cjs",
];

const LAYER_LOCAL_CONFIG_KEYS = new Set([
  "root",
  "srcDir",
  "outDir",
  "distDir",
  "deploy",
  "output",
  "preset",
  "publicDir",
  "generateBuildId",
]);

type LoadedLayer = ResolvedFarmLayer & {
  config: Record<string, any>;
};

export async function resolveFarmLayers<TConfig extends Record<string, any>>(
  projectConfig: TConfig,
  options: ResolveFarmLayersOptions,
): Promise<FarmLayerResolution<TConfig>> {
  const projectRoot = path.resolve(options.root);
  const entries = normalizeLayerEntries(projectConfig.extends, "project config");

  if (entries.length === 0) {
    return {
      config: {
        ...projectConfig,
        layers: [],
      },
      layers: [],
    };
  }

  const loadedLayers: LoadedLayer[] = [];
  const visited = new Set<string>();
  const aliases = new Map<string, string>();

  const visit = async (
    source: string,
    ownerRoot: string,
    stack: Array<{ root: string; source: string }>,
  ): Promise<void> => {
    const resolvedSource = resolveLayerSource(source, ownerRoot);
    const cycleIndex = stack.findIndex((entry) => entry.root === resolvedSource.root);
    if (cycleIndex !== -1) {
      const cycle = [...stack.slice(cycleIndex).map((entry) => entry.source), source];
      throw new Error(`Farm layer cycle detected: ${cycle.join(" -> ")}`);
    }
    if (visited.has(resolvedSource.root)) return;

    const configFile = findFarmConfigFile(resolvedSource.root, resolvedSource.configFile);
    const config = configFile
      ? await loadFarmConfigFile(configFile, {
          cacheRoot: projectRoot,
          root: resolvedSource.root,
        })
      : {};
    const nestedEntries = normalizeLayerEntries(config.extends, `layer ${JSON.stringify(source)}`);
    const nextStack = [...stack, { root: resolvedSource.root, source }];

    for (const nestedSource of nestedEntries) {
      await visit(nestedSource, resolvedSource.root, nextStack);
    }

    if (visited.has(resolvedSource.root)) return;

    const name = getLayerName(source, resolvedSource.root);
    const conflictingRoot = aliases.get(name);
    if (conflictingRoot && conflictingRoot !== resolvedSource.root) {
      throw new Error(
        `Farm layer alias "#layers/${name}" is ambiguous between ${conflictingRoot} and ${resolvedSource.root}`,
      );
    }
    aliases.set(name, resolvedSource.root);

    visited.add(resolvedSource.root);
    loadedLayers.push({
      source,
      name,
      root: resolvedSource.root,
      srcDir: normalizeLayerSrcDir(config.srcDir),
      configFile,
      config,
    });
  };

  for (const source of entries) {
    await visit(source, projectRoot, []);
  }

  let mergedConfig: Record<string, any> = {};
  for (const layer of loadedLayers) {
    mergedConfig = mergeFarmLayerConfig(mergedConfig, getLayerDefaults(layer.config));
  }
  mergedConfig = mergeFarmLayerConfig(mergedConfig, projectConfig);

  const layers = loadedLayers.map(({ config: _config, ...layer }) => layer);
  return {
    config: {
      ...mergedConfig,
      root: projectConfig.root,
      srcDir: projectConfig.srcDir,
      extends: projectConfig.extends,
      layers,
    } as unknown as FarmLayerResolution<TConfig>["config"],
    layers,
  };
}

export function getFarmSourceRoots(config: {
  root?: string;
  srcDir?: string;
  layers?: readonly ResolvedFarmLayer[];
}): FarmSourceRoot[] {
  const roots: FarmSourceRoot[] = (config.layers ?? []).map((layer) => ({
    name: layer.name,
    root: layer.root,
    srcDir: layer.srcDir,
    layer: true,
  }));

  roots.push({
    name: "project",
    root: path.resolve(config.root || process.cwd()),
    srcDir: config.srcDir || "src",
    layer: false,
  });

  return roots;
}

export function getFarmAppDirectories(config: {
  root?: string;
  srcDir?: string;
  layers?: readonly ResolvedFarmLayer[];
}): string[] {
  return getFarmSourceRoots(config).map((source) => path.join(source.root, source.srcDir, "app"));
}

export function getFarmLayerAliases(
  layers: readonly ResolvedFarmLayer[] | undefined,
): Record<string, string> {
  return Object.fromEntries(
    (layers ?? []).map((layer) => [`#layers/${layer.name}`, path.join(layer.root, layer.srcDir)]),
  );
}

export async function loadFarmConfigFile<TConfig = Record<string, any>>(
  configPath: string,
  options: { root: string; cacheRoot?: string },
): Promise<TConfig> {
  const { build, transform } = await import("esbuild");
  const cacheRoot = path.resolve(options.cacheRoot || options.root);
  const configCacheDir = path.join(cacheRoot, ".farm", ".config-loader");
  const configEntryChecks = new Map<string, Promise<boolean>>();
  await mkdir(configCacheDir, { recursive: true });

  const modulePath = path.join(
    configCacheDir,
    `farm-config-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );

  await build({
    absWorkingDir: path.resolve(options.root),
    entryPoints: [path.resolve(configPath)],
    outfile: modulePath,
    bundle: true,
    format: "esm",
    platform: "node",
    target: `node${process.versions.node.split(".")[0]}`,
    plugins: [
      {
        name: "farm-config-package-resolution",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^@farmjs\/core$/ }, async (args) => {
            if (
              args.pluginData?.farmConfigExternal ||
              args.kind !== "import-statement" ||
              !args.importer
            ) {
              return;
            }

            let configEntryCheck = configEntryChecks.get(args.importer);
            if (!configEntryCheck) {
              configEntryCheck = onlyImportsFarmConfigHelpers(args.importer, transform);
              configEntryChecks.set(args.importer, configEntryCheck);
            }
            if (!(await configEntryCheck)) return;

            const resolved = await pluginBuild.resolve(FARM_CONFIG_ENTRY, {
              importer: args.importer,
              kind: args.kind,
              namespace: args.namespace,
              resolveDir: args.resolveDir,
              pluginData: { farmConfigExternal: true },
            });
            if (resolved.errors.length > 0 || !resolved.path) return;

            return {
              path: resolved.path,
              external: true,
              warnings: resolved.warnings,
            };
          });

          pluginBuild.onResolve({ filter: /^[^./]/ }, async (args) => {
            if (args.pluginData?.farmConfigExternal) return;

            const resolved = await pluginBuild.resolve(args.path, {
              importer: args.importer,
              kind: args.kind,
              namespace: args.namespace,
              resolveDir: args.resolveDir,
              pluginData: { farmConfigExternal: true },
            });

            if (resolved.errors.length > 0 || !resolved.path) {
              return { path: args.path, external: true };
            }

            return {
              path: resolved.path,
              external: true,
              warnings: resolved.warnings,
            };
          });
        },
      },
    ],
    jsx: "automatic",
    logLevel: "silent",
    sourcemap: "inline",
  });

  const moduleUrl = `${pathToFileURL(modulePath).href}?t=${Date.now()}`;
  try {
    const loaded = await import(/* @vite-ignore */ moduleUrl);
    const config = loaded.default || loaded;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new TypeError(`Farm config ${configPath} must export an object`);
    }
    return config as TConfig;
  } finally {
    await unlink(modulePath).catch(() => undefined);
  }
}

async function onlyImportsFarmConfigHelpers(
  importer: string,
  transform: EsbuildTransform,
): Promise<boolean> {
  try {
    const source = readFileSync(importer, "utf8");
    if (!source.includes(FARM_CORE_PACKAGE)) return false;

    const transformed = await transform(source, {
      format: "esm",
      jsx: "automatic",
      loader: getEsbuildLoader(importer),
      sourcefile: importer,
    });
    const references = [...transformed.code.matchAll(FARM_CORE_REFERENCE_RE)];
    if (references.length === 0) return false;

    const safeImportRanges: Array<{ start: number; end: number }> = [];
    for (const match of transformed.code.matchAll(FARM_CONFIG_HELPER_IMPORT_RE)) {
      const specifiers = match[1]
        .split(",")
        .map((specifier) => specifier.trim())
        .filter(Boolean);
      if (
        specifiers.length === 0 ||
        !specifiers.every((specifier) => FARM_CONFIG_HELPER_SPECIFIER_RE.test(specifier))
      ) {
        continue;
      }

      const start = match.index ?? 0;
      safeImportRanges.push({ start, end: start + match[0].length });
    }

    return references.every((reference) => {
      const index = reference.index ?? -1;
      return safeImportRanges.some((range) => index >= range.start && index < range.end);
    });
  } catch {
    // Unsupported syntax or non-file importers retain the existing package resolution path.
    return false;
  }
}

function getEsbuildLoader(file: string): "js" | "jsx" | "ts" | "tsx" {
  switch (path.extname(file)) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "ts";
    case ".tsx":
      return "tsx";
    case ".jsx":
      return "jsx";
    default:
      return "js";
  }
}

function normalizeLayerEntries(value: unknown, owner: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`${owner} "extends" must be an array of layer paths or package names`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new TypeError(`${owner} "extends" entry ${index} must be a non-empty string`);
    }
    return entry.trim();
  });
}

function resolveLayerSource(
  source: string,
  ownerRoot: string,
): { root: string; configFile?: string } {
  if (isPathLayerSource(source)) {
    const target = source.startsWith("file:")
      ? path.resolve(ownerRoot, source.slice("file:".length))
      : path.resolve(ownerRoot, source);
    if (!existsSync(target)) {
      throw new Error(`Cannot resolve Farm layer ${JSON.stringify(source)} from ${ownerRoot}`);
    }

    const stats = statSync(target);
    const root = stats.isDirectory() ? target : path.dirname(target);
    return {
      root: normalizeRealPath(root),
      configFile: stats.isFile() ? normalizeRealPath(target) : undefined,
    };
  }

  const requireFromOwner = createRequire(path.join(ownerRoot, "package.json"));
  let packageJsonPath: string | undefined;
  try {
    packageJsonPath = requireFromOwner.resolve(`${source}/package.json`);
  } catch {
    // Packages with an exports map often hide package.json. Resolve their entry and walk upward.
  }

  if (packageJsonPath) {
    return { root: normalizeRealPath(path.dirname(packageJsonPath)) };
  }

  try {
    const entryPath = requireFromOwner.resolve(source);
    const packageRoot = findNearestPackageRoot(entryPath);
    if (packageRoot) return { root: normalizeRealPath(packageRoot) };
  } catch {
    // Use the common error below so local and package failures have the same shape.
  }

  throw new Error(`Cannot resolve Farm layer package ${JSON.stringify(source)} from ${ownerRoot}`);
}

function findNearestPackageRoot(entryPath: string): string | null {
  let current = statSync(entryPath).isDirectory() ? entryPath : path.dirname(entryPath);
  while (true) {
    if (existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findFarmConfigFile(root: string, explicitPath?: string): string | undefined {
  if (explicitPath) return explicitPath;
  for (const fileName of CONFIG_FILENAMES) {
    const candidate = path.join(root, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function getLayerName(source: string, root: string): string {
  if (!isPathLayerSource(source)) {
    const packageName = source.split("/").filter(Boolean).pop();
    if (packageName) return sanitizeLayerName(packageName);
  }

  try {
    const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    if (typeof packageJson.name === "string") {
      return sanitizeLayerName(packageJson.name.split("/").pop() || packageJson.name);
    }
  } catch {
    // A local layer does not need package metadata.
  }

  return sanitizeLayerName(path.basename(root));
}

function sanitizeLayerName(value: string): string {
  const name = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name) throw new Error(`Cannot derive a name for Farm layer ${JSON.stringify(value)}`);
  return name;
}

function normalizeLayerSrcDir(value: unknown): string {
  if (value === undefined) return "src";
  if (typeof value !== "string" || value.trim() === "" || path.isAbsolute(value)) {
    throw new TypeError("A Farm layer srcDir must be a non-empty relative path");
  }
  const normalized = path.normalize(value.trim());
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new TypeError("A Farm layer srcDir cannot leave the layer root");
  }
  return normalized;
}

function getLayerDefaults(config: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) =>
        key !== "extends" && value !== undefined && !LAYER_LOCAL_CONFIG_KEYS.has(key),
    ),
  );
}

function mergeFarmLayerConfig(
  base: Record<string, any>,
  override: Record<string, any>,
): Record<string, any> {
  const output: Record<string, any> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || key === "layers") continue;

    if (key === "plugins") {
      output[key] = [...toArray(output[key]), ...toArray(value)];
      continue;
    }

    if (key === "middleware" && output[key] !== undefined) {
      output[key] = [...toArray(output[key]), ...toArray(value)];
      continue;
    }

    if ((key === "redirects" || key === "rewrites" || key === "headers") && output[key]) {
      output[key] = mergeConfigListResolvers(output[key], value);
      continue;
    }

    if (isPlainObject(output[key]) && isPlainObject(value)) {
      output[key] = mergePlainObjects(output[key], value);
      continue;
    }

    output[key] = value;
  }

  return output;
}

function mergePlainObjects(base: Record<string, any>, override: Record<string, any>) {
  const output: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    output[key] =
      isPlainObject(output[key]) && isPlainObject(value)
        ? mergePlainObjects(output[key], value)
        : value;
  }
  return output;
}

function mergeConfigListResolvers(base: unknown, override: unknown) {
  return async () => [...(await resolveConfigList(base)), ...(await resolveConfigList(override))];
}

async function resolveConfigList(value: unknown): Promise<any[]> {
  const resolved = typeof value === "function" ? await value() : value;
  return toArray(resolved);
}

function toArray(value: unknown): any[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isPlainObject(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPathLayerSource(source: string): boolean {
  return (
    source.startsWith(".") ||
    source.startsWith("/") ||
    source.startsWith("file:") ||
    /^[a-zA-Z]:[\\/]/.test(source)
  );
}

function normalizeRealPath(value: string): string {
  return path.resolve(realpathSync(value));
}
