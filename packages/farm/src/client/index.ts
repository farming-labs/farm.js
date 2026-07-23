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
export { useBlocker, useNavigation, usePageState, useRouter, useScrollRestoration } from "./router";
export type { UseBlockerOptions, UseBlockerReturn, UseRouterOptions } from "./router";
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
export {
  getRouter,
  navigateTo,
  prefetch,
  pushState,
  readPageState,
  replaceState,
  SPARouter,
} from "./spa-router";
export { installChunkErrorRecovery, isChunkLoadError } from "./chunk-recovery";
export type { FarmChunkRecoveryOptions } from "./chunk-recovery";
export { createClientPluginManager, FarmClientPluginManager } from "./plugin";
export type {
  FarmClientHydrationCompleteEvent,
  FarmClientHydrationEvent,
  FarmClientHydrationMode,
  FarmClientHydrationSession,
  FarmClientLocation,
  FarmClientNavigationAction,
  FarmClientNavigationErrorEvent,
  FarmClientNavigationEvent,
  FarmClientNavigationLoadedEvent,
  FarmClientNavigationResolvedEvent,
  FarmClientNavigationSession,
  FarmClientPerformanceEvent,
  FarmClientPlugin,
  FarmClientPluginCloseEvent,
  FarmClientPluginEnforce,
  FarmClientPluginErrorEvent,
  FarmClientPluginErrorPhase,
  FarmClientPluginManagerOptions,
  FarmClientPluginMetadata,
  FarmClientPluginRegistration,
  FarmClientPluginRouter,
  FarmClientPluginSetupEvent,
  FarmClientPluginStateEvent,
} from "./plugin";
export type {
  FarmNavigateOptions,
  FarmNavigationListener,
  FarmNavigationLocation,
  FarmNavigationBlocker,
  FarmNavigationBlockerContext,
  FarmNavigationState,
  FarmViewTransitionMode,
} from "./spa-router";
export type { PageProps, LayoutProps, Metadata } from "../types";
