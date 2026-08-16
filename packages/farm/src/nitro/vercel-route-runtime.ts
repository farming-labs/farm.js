import path from "path";
import {
  createFarmRouteRuntimeKey,
  type FarmRouteRuntimeManifest,
  type FarmRouteRuntimeManifestEntry,
  type ResolvedFarmRouteRuntimeConfig,
} from "../route-runtime";

export interface FarmVercelRuntimeRoute {
  src: string;
  dest: string;
  headers?: Record<string, string>;
}

type FileSystemPromises = typeof import("fs/promises");

/** Materialize one Node function per distinct region/duration policy. */
export async function createFarmVercelRouteRuntimeFunctions(
  outputDir: string,
  manifest: FarmRouteRuntimeManifest,
  fs: FileSystemPromises,
): Promise<FarmVercelRuntimeRoute[]> {
  const dynamicRoutes = manifest.routes.filter(
    (route) => route.rendering === "dynamic" && route.runtime !== "edge",
  );
  if (!dynamicRoutes.some(hasVercelFunctionControls)) return [];

  const configuredRoutes = dynamicRoutes
    .filter((route) => route.kind !== "rule" || hasVercelFunctionControls(route))
    .sort(compareRuntimeRoutes);
  if (configuredRoutes.length === 0) return [];

  const groups = new Map<
    string,
    { config: ResolvedFarmRouteRuntimeConfig; routes: FarmRouteRuntimeManifestEntry[] }
  >();

  for (const route of configuredRoutes) {
    const config = {
      runtime: route.runtime === "auto" ? "node" : route.runtime,
      regions: route.regions,
      maxDuration: route.maxDuration,
    } satisfies ResolvedFarmRouteRuntimeConfig;
    const key = createFarmRouteRuntimeKey(config);
    const group = groups.get(key) || { config, routes: [] };
    group.routes.push(route);
    groups.set(key, group);
  }

  const functionsDir = path.join(outputDir, "functions");
  const baseFunctionDir = path.join(functionsDir, "__nitro.func");
  const destinations = new Map<string, string>();
  let groupIndex = 0;

  for (const [key, group] of groups) {
    if (!group.config.regions?.length && !group.config.maxDuration) {
      destinations.set(key, "/__nitro");
      continue;
    }

    groupIndex += 1;
    const functionName = `__farm_runtime_${groupIndex}`;
    const functionDir = path.join(functionsDir, `${functionName}.func`);
    await fs.cp(baseFunctionDir, functionDir, { recursive: true, force: true });
    await configureVercelFunction(functionDir, group.config, fs);
    destinations.set(key, `/${functionName}`);
  }

  const routes: FarmVercelRuntimeRoute[] = [];
  const seenSources = new Set<string>();
  for (const route of configuredRoutes) {
    const src = farmRoutePatternToVercelSource(route.pattern);
    if (seenSources.has(src)) continue;
    seenSources.add(src);
    const key = createFarmRouteRuntimeKey({
      runtime: route.runtime === "auto" ? "node" : route.runtime,
      regions: route.regions,
      maxDuration: route.maxDuration,
    });
    routes.push({
      src,
      dest: destinations.get(key) || "/__nitro",
      ...(route.kind === "api" || route.pattern.startsWith("/api/")
        ? {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "*",
              "Access-Control-Allow-Headers": "*",
            },
          }
        : {}),
    });
  }

  return routes;
}

export function farmRoutePatternToVercelSource(pattern: string): string {
  const normalized = normalizePattern(pattern);
  if (normalized === "/") return "/";

  let source = "";
  for (const segment of normalized.split("/").filter(Boolean)) {
    if (segment === "**" || /^\[\[\.\.\..+\]\]$/.test(segment)) {
      source += "(?:/(.*))?";
    } else if (/^\[\.\.\..+\]$/.test(segment)) {
      source += "/(.+)";
    } else if (segment === "*" || /^\[.+\]$/.test(segment)) {
      source += "/([^/]+)";
    } else {
      source += `/${escapeRegExp(segment)}`;
    }
  }

  return source || "/";
}

async function configureVercelFunction(
  functionDir: string,
  config: ResolvedFarmRouteRuntimeConfig,
  fs: FileSystemPromises,
): Promise<void> {
  const configPath = path.join(functionDir, ".vc-config.json");
  const current = JSON.parse(await fs.readFile(configPath, "utf8"));
  const next = {
    ...current,
    ...(config.regions?.length ? { regions: config.regions } : {}),
    ...(config.maxDuration ? { maxDuration: config.maxDuration } : {}),
  };
  await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
}

function hasVercelFunctionControls(route: FarmRouteRuntimeManifestEntry): boolean {
  return Boolean(route.regions?.length || route.maxDuration);
}

function compareRuntimeRoutes(
  left: FarmRouteRuntimeManifestEntry,
  right: FarmRouteRuntimeManifestEntry,
): number {
  const kindOrder = { page: 0, api: 0, metadata: 0, rule: 1 };
  const kindDifference = kindOrder[left.kind] - kindOrder[right.kind];
  if (kindDifference !== 0) return kindDifference;

  const specificityDifference =
    getPatternSpecificity(right.pattern) - getPatternSpecificity(left.pattern);
  return specificityDifference || left.pattern.localeCompare(right.pattern);
}

function getPatternSpecificity(pattern: string): number {
  return normalizePattern(pattern)
    .split("/")
    .filter(Boolean)
    .reduce((score, segment) => {
      if (segment === "**" || segment.startsWith("[[...")) return score + 1;
      if (segment === "*" || segment.startsWith("[...")) return score + 10;
      if (/^\[.+\]$/.test(segment)) return score + 50;
      return score + 100;
    }, 0);
}

function normalizePattern(value: string): string {
  const trimmed = value.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
