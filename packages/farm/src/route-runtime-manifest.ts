import path from "path";
import type { APIRouteManager } from "./api/route-manager";
import { resolveFarmAPIServerBasePath, resolveFarmAPIServerRoutePath } from "./api/server-path";
import type { ResolvedFarmConfig } from "./config";
import { getFarmPresetRuntime, type FarmPresetRuntime } from "./deployment";
import {
  getFarmRouteRuntimeConfig,
  hasFarmRouteRuntimeControls,
  mergeFarmRouteRuntimeConfigs,
  normalizeFarmRouteRuntimeConfig,
  resolveFarmRouteRuleRuntimeConfig,
  resolveFarmRouteRuntimeConfig,
  type FarmRouteRuntimeManifest,
  type FarmRouteRuntimeManifestEntry,
} from "./route-runtime";
import type { RouteManager } from "./routing/route-manager";
import { resolveRouteRenderingConfigFromFile } from "./ssg";

export const FARM_ROUTE_RUNTIME_MANIFEST = "route-runtime-manifest.json";

export interface FarmRouteRuntimeDeploymentValidation {
  runtime: FarmPresetRuntime;
  warnings: string[];
}

export async function createFarmRouteRuntimeManifest(options: {
  config: ResolvedFarmConfig;
  routeManager: RouteManager;
  apiRouteManager: APIRouteManager;
  root?: string;
}): Promise<FarmRouteRuntimeManifest> {
  const root = path.resolve(options.root || options.config.root || process.cwd());
  const routes: FarmRouteRuntimeManifestEntry[] = [];

  for (const [pattern, entry] of options.routeManager.getRoutes()) {
    const routeModule = await options.routeManager.loadRouteModule(entry.modulePath);
    const rendering = await resolveRouteRenderingConfigFromFile(routeModule, entry.modulePath);
    const runtimeConfig = await options.routeManager.resolveRouteRuntimeConfig(pattern);

    routes.push({
      kind: "page",
      pattern,
      rendering: rendering.ssg ? "static" : "dynamic",
      source: normalizeManifestSource(root, entry.modulePath),
      ...runtimeConfig,
    });
  }

  for (const [pattern, route] of options.apiRouteManager.getRoutes()) {
    const publicPattern = resolveFarmAPIServerRoutePath(
      pattern,
      resolveFarmAPIServerBasePath(options.config.api),
    );
    const inherited = resolveFarmRouteRuleRuntimeConfig(publicPattern, options.config.routeRules);
    const own = normalizeFarmRouteRuntimeConfig(
      getFarmRouteRuntimeConfig(route),
      `API route "${pattern}"`,
    );

    routes.push({
      kind: "api",
      pattern: publicPattern,
      rendering: "dynamic",
      source: normalizeManifestSource(root, route.filePath),
      ...resolveFarmRouteRuntimeConfig(
        mergeFarmRouteRuntimeConfigs(inherited, own),
        `API route "${pattern}"`,
      ),
    });
  }

  for (const entry of options.routeManager.getMetadataRoutes().values()) {
    const routeModule = await options.routeManager.loadRouteModule(entry.modulePath);
    const pattern =
      entry.pattern === "/" ? `/${entry.outputName}` : `${entry.pattern}/${entry.outputName}`;
    const inherited = resolveFarmRouteRuleRuntimeConfig(pattern, options.config.routeRules);
    const own = normalizeFarmRouteRuntimeConfig(
      getFarmRouteRuntimeConfig(routeModule),
      `Metadata route "${pattern}"`,
    );

    routes.push({
      kind: "metadata",
      pattern,
      rendering: "dynamic",
      source: normalizeManifestSource(root, entry.modulePath),
      ...resolveFarmRouteRuntimeConfig(
        mergeFarmRouteRuntimeConfigs(inherited, own),
        `Metadata route "${pattern}"`,
      ),
    });
  }

  for (const [pattern, rule] of Object.entries(options.config.routeRules)) {
    if (!hasFarmRouteRuntimeControls(rule)) continue;

    routes.push({
      kind: "rule",
      pattern,
      rendering: rule.prerender || rule.render === "static" ? "static" : "dynamic",
      ...resolveFarmRouteRuntimeConfig(rule, `Route rule "${pattern}"`),
    });
  }

  return {
    version: 1,
    routes,
  };
}

export async function writeFarmRouteRuntimeManifest(
  directory: string,
  manifest: FarmRouteRuntimeManifest,
): Promise<string> {
  const fs = await import("fs/promises");
  const manifestPath = path.join(directory, FARM_ROUTE_RUNTIME_MANIFEST);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

export function validateFarmRouteRuntimeDeployment(
  manifest: FarmRouteRuntimeManifest,
  preset: string,
): FarmRouteRuntimeDeploymentValidation {
  const runtime = getFarmPresetRuntime(preset);
  const warnings = new Set<string>();

  for (const route of manifest.routes) {
    if (route.rendering === "static") continue;

    if (runtime === "unknown" && route.runtime !== "auto") {
      warnings.add(
        `Preset "${preset}" has an unknown runtime, so Farm could not verify routes that explicitly require node or edge.`,
      );
    }

    if (runtime !== "unknown" && route.runtime !== "auto" && route.runtime !== runtime) {
      throw new Error(
        `Route "${route.pattern}" requires the ${route.runtime} runtime, but preset "${preset}" emits ${runtime} functions. Choose a compatible preset or change the route runtime.`,
      );
    }

    if (route.regions?.length && preset !== "vercel" && preset !== "vercel-edge") {
      warnings.add(
        `Preset "${preset}" does not map per-route regions; Farm kept them in ${FARM_ROUTE_RUNTIME_MANIFEST} for deployment adapters.`,
      );
    }

    if (route.maxDuration && preset !== "vercel") {
      warnings.add(
        `Preset "${preset}" does not map per-route maxDuration; Farm kept it in ${FARM_ROUTE_RUNTIME_MANIFEST} for deployment adapters.`,
      );
    }
  }

  return { runtime, warnings: Array.from(warnings) };
}

function normalizeManifestSource(root: string, modulePath: string): string {
  const queryIndex = modulePath.indexOf("?");
  const filePath = queryIndex === -1 ? modulePath : modulePath.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : modulePath.slice(queryIndex);
  const relativePath = path.isAbsolute(filePath) ? path.relative(root, filePath) : filePath;
  return `${relativePath.replace(/\\/g, "/")}${query}`;
}
