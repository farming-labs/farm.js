import type { FarmIslandStrategy } from "../island";
import type { RouteRenderingConfig } from "../ssg";

/**
 * A build-time rendering decision consumed by the browser router.
 *
 * The browser never inspects module source to choose a rendering path. It
 * executes this compact plan and only evaluates request-specific cache keys at
 * runtime.
 */
export interface FarmRouteRenderPlan {
  version: 1;
  output: "html";
  navigation: "html-fragment";
  hydration: "none" | "route-island" | "layout-island" | "route-and-layout-islands";
  islandStrategy: FarmIslandStrategy | null;
  cache: {
    mode: "static" | "revalidate" | "dynamic";
    revalidate?: number;
  };
}

export interface FarmRouteRenderPlanInput {
  pageShouldHydrate?: boolean;
  layoutShouldHydrate?: boolean;
  islandStrategy?: FarmIslandStrategy | null;
  rendering?: Pick<RouteRenderingConfig, "ssg" | "ppr" | "revalidate">;
}

/** Create a deterministic route plan during manifest generation. */
export function createFarmRouteRenderPlan(
  input: FarmRouteRenderPlanInput = {},
): FarmRouteRenderPlan {
  const pageShouldHydrate = input.pageShouldHydrate === true;
  const layoutShouldHydrate = input.layoutShouldHydrate === true;
  const hydration = pageShouldHydrate
    ? layoutShouldHydrate
      ? "route-and-layout-islands"
      : "route-island"
    : layoutShouldHydrate
      ? "layout-island"
      : "none";

  const rendering = input.rendering;
  const cache = rendering?.ssg
    ? typeof rendering.revalidate === "number" && rendering.revalidate > 0
      ? { mode: "revalidate" as const, revalidate: rendering.revalidate }
      : { mode: "static" as const }
    : { mode: "dynamic" as const };

  return {
    version: 1,
    output: "html",
    navigation: "html-fragment",
    hydration,
    islandStrategy: hydration === "none" ? null : (input.islandStrategy ?? "load"),
    cache,
  };
}

/**
 * Cache policy for a fragment response. Explicit static rendering is safe to
 * share; dynamic output remains private even when the browser caches it.
 */
export function getFarmFragmentCacheControl(plan: FarmRouteRenderPlan): string {
  if (plan.cache.mode === "static") {
    return "public, max-age=0, s-maxage=31536000, immutable";
  }
  if (plan.cache.mode === "revalidate") {
    const seconds = Math.max(1, plan.cache.revalidate ?? 1);
    return `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds}`;
  }
  return "private, max-age=0";
}

export function parseFarmLayoutChainHeader(value: string | null): string[] {
  if (!value || value.length > 8_192) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 64) return [];
    return parsed.filter(
      (pattern): pattern is string =>
        typeof pattern === "string" && pattern.startsWith("/") && pattern.length <= 512,
    );
  } catch {
    return [];
  }
}

export function getSharedLayoutPrefixLength(current: string[], next: string[]): number {
  let index = 0;
  while (index < current.length && index < next.length && current[index] === next[index]) {
    index++;
  }
  return index;
}
