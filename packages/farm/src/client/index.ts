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
export { APIClientError, createAPIClient, createServerAPIClient } from "../api/client";
export type {
  APIClient,
  APIClientOptions,
  APIClientSystemError,
  APIClientWithoutIntegrationsOptions,
  RouteAPIClient,
  ServerAPIClient,
  ServerAPIClientOptions,
  ServerAPIClientWithoutIntegrationsOptions,
} from "../api/client";
export type { FarmAPIStream } from "../api/transport";
export { useMutation } from "../mutation-client";
export type {
  AnyMutationTarget,
  InferMutationData,
  InferMutationError,
  InferMutationVariables,
  MutationAsync,
  MutationOptimisticContext,
  MutationStatus,
  MutationTrigger,
  UseMutationOptions,
  UseMutationReturn,
} from "../mutation-client";
export { useFetcher } from "../fetcher-client";
export type {
  FetcherFormDataContext,
  FetcherFormProps,
  FetcherState,
  FetcherSubmit,
  FetcherSubmitAsync,
  UseFetcherOptions,
  UseFetcherReturn,
} from "../fetcher-client";
export { useAction } from "../server-fn-client";
export type {
  RouteActionTarget,
  UseActionFormProps,
  UseActionReturn,
  UseServerFnOptions,
} from "../server-fn-client";
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
export type {
  AppRoutePattern,
  ErrorProps,
  GenerateStaticParams,
  LayoutMetadataProps,
  LayoutProps,
  LoadingProps,
  Metadata,
  MetadataProps,
  PageProps,
  PageRouteParams,
  StaticRouteParams,
} from "../types";
