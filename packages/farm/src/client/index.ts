/**
 * Farm.js Client-Side Utilities
 *
 * These exports are for client-side use only.
 * They enable SPA navigation and client-side routing.
 */

export { Link } from "./link";
export type {
  LinkProps,
  PrefetchBehavior,
  LinkDefaultRoute,
  DefaultRoutePath,
  DefaultRoutePattern,
  DefaultRouteHref,
  ExternalHref,
  RouteHref,
  RouteParamValue,
  RouteOptionalParamValue,
  RouteParams,
} from "./link";
export { useRouter } from "./router";
export type { UseRouterOptions } from "./router";
export { buildFarmRoutePath, createFarmRouter, isFarmRouteActive, matchFarmRoute } from "../router";
export type {
  FarmRouter,
  FarmRouterActiveOptions,
  FarmRouterBuildOptions,
  FarmRouterMatch,
  FarmRouterParams,
  FarmRouterPathParam,
  FarmRouterPathParams,
  FarmRouterQueryValue,
  FarmRouterRoute,
  FarmRouterRouteInput,
} from "../router";
export { createAPIClient, createServerAPIClient } from "../api/client";
export type {
  APIClient,
  APIClientOptions,
  APIClientWithoutIntegrationsOptions,
  RouteAPIClient,
  ServerAPIClient,
  ServerAPIClientOptions,
  ServerAPIClientWithoutIntegrationsOptions,
} from "../api/client";
export { getRouter, navigateTo, prefetch, SPARouter } from "./spa-router";
export type { PageProps, LayoutProps, Metadata } from "../types";
