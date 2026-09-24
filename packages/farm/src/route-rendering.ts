import type { RouteModule } from "./types";

/**
 * The rendering-mode merge shared by every consumer of route directives.
 *
 * Development resolves `"use ssg; 60"` and friends by reading the route
 * source; production output cannot read files, so the build bakes the parsed
 * directive into each route registration and the generated server entry
 * merges it here with the module's exports - the same precedence, one
 * implementation, no filesystem dependency so edge presets stay clean.
 */

export type RouteRenderingDynamic = NonNullable<RouteModule["dynamic"]>;

export interface RouteRenderingConfig {
  ssg: boolean;
  ppr: boolean;
  revalidate?: number;
  dynamic?: RouteRenderingDynamic;
  directive?: string;
}

export interface RouteRenderingOptions {
  /**
   * Whether `experimental.ppr` is enabled in the app config. Route-level PPR
   * opt-ins (`ppr`, `experimental_ppr`, `"use ppr"`) are inert without it.
   */
  experimentalPPR?: boolean;
}

export interface DirectiveRenderingConfig {
  ssg: boolean;
  ppr: boolean;
  revalidate?: number;
  dynamic?: RouteRenderingDynamic;
  directive: string;
}

export function normalizeDynamicMode(value: unknown): RouteRenderingDynamic | undefined {
  switch (value) {
    case "auto":
    case "force-static":
    case "force-dynamic":
    case "error":
      return value;
    default:
      return undefined;
  }
}

/** Merge a parsed rendering directive with a route module's explicit exports. */
export function mergeRouteRenderingDirectiveConfig(
  directiveConfig: DirectiveRenderingConfig | undefined,
  mod: RouteModule | null | undefined,
  options?: RouteRenderingOptions,
): RouteRenderingConfig {
  const pprEnabled = options?.experimentalPPR === true;
  let ssg = directiveConfig?.ssg ?? false;
  let requestedPPR = directiveConfig?.ppr ?? false;
  let revalidate = directiveConfig?.revalidate;
  const moduleDynamic = normalizeDynamicMode(mod?.dynamic);
  const dynamic = moduleDynamic ?? directiveConfig?.dynamic;
  const hasExplicitSsg = typeof mod?.ssg === "boolean";
  const hasExplicitPPR =
    typeof mod?.ppr === "boolean" || typeof mod?.experimental_ppr === "boolean";

  if (hasExplicitSsg) {
    ssg = mod!.ssg === true;
  }

  if (hasExplicitPPR) {
    requestedPPR = mod?.ppr === true || mod?.experimental_ppr === true;
  }

  if (typeof mod?.revalidate === "number") {
    if (mod.revalidate > 0) {
      revalidate = mod.revalidate;
      // A PPR opt-in keeps the route dynamic even while experimental.ppr is
      // off: the page expects Suspense holes, so falling back to ISR would
      // bake request-time content into a shared static artifact.
      if (!hasExplicitSsg && !requestedPPR) {
        ssg = true;
      }
    } else {
      revalidate = undefined;
      if (!hasExplicitSsg) {
        ssg = false;
      }
    }
  } else if (mod?.revalidate === false) {
    revalidate = undefined;
  }

  if (moduleDynamic === "force-static" || moduleDynamic === "error") {
    ssg = true;
    requestedPPR = false;
  } else if (moduleDynamic === "force-dynamic") {
    ssg = false;
    requestedPPR = false;
    revalidate = undefined;
  }

  const ppr = pprEnabled && !ssg && requestedPPR;

  return {
    ssg,
    ppr,
    revalidate: ssg || ppr ? revalidate : undefined,
    dynamic,
    directive: directiveConfig?.directive,
  };
}
