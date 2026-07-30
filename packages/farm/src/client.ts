export { APIClientError, createAPIClient, createServerAPIClient } from "./api/client";
export type {
  APIClient,
  APIClientOptions,
  APIClientSystemError,
  APIClientWithoutIntegrationsOptions,
  RouteAPIClient,
  ServerAPIClient,
  ServerAPIClientOptions,
  ServerAPIClientWithoutIntegrationsOptions,
} from "./api/client";
export type { FarmAPIStream } from "./api/transport";
export { useMutation } from "./mutation-client";
export type {
  InferMutationData,
  InferMutationError,
  InferMutationVariables,
  MutationAsync,
  MutationOptimisticContext,
  MutationStatus,
  MutationTrigger,
  UseMutationOptions,
  UseMutationReturn,
} from "./mutation-client";
export { fetchServerQuery, prefetchServerQuery, useServerQuery } from "./server-query-client";
export type {
  ServerQueryFetchOptions,
  UseServerQueryOptions,
  UseServerQueryResult,
} from "./server-query-client";
export {
  api,
  endpoint,
  defineIntegrationAPI,
  defineIntegrationAPIOperation,
} from "./integration-api";
export type {
  FarmIntegrationAPI,
  FarmIntegrationAPIBodyFormat,
  FarmIntegrationAPIMethod,
  FarmIntegrationAPIOperation,
  FarmIntegrationAPIResponseFormat,
} from "./integration-api";
export { createIntegrationClient, IntegrationClientError } from "./integration-client";
export {
  createIntegrationApi,
  createIntegrationClients,
  createIntegrations,
  createIntegrationServerClient,
  getIntegrationAPIManifest,
  integrationClients,
  integrationsClient,
  integrationsServer,
} from "./integration-client";
export type {
  IntegrationClient,
  IntegrationClientAliases,
  IntegrationClientRoot,
  IntegrationClientOptions,
  IntegrationClientRequestOptions,
  IntegrationAPI,
  IntegrationClients,
  IntegrationClientData,
  IntegrationOperationResult,
  InferIntegrationOperationBody,
  InferIntegrationOperationQuery,
  InferIntegrationOperationResponse,
  IntegrationServerClient,
  IntegrationServerClientAliases,
  IntegrationServerClientOptions,
  IntegrationServerClientRequestOptions,
  IntegrationServerClientRoot,
  IntegrationServerRequestLike,
} from "./integration-client";
export { createStore } from "./store";
export type {
  Store,
  StoreApi,
  StoreFields,
  StoreListener,
  StoreKeyListener,
  StoreKeysListener,
  StorePatch,
  StoreState,
  StoreValueUpdater,
} from "./store";

// SPA Navigation exports
export { Link } from "./client/link";
export {
  useBlocker,
  useNavigation,
  usePageState,
  useRouter,
  useScrollRestoration,
} from "./client/router";
export {
  SPARouter,
  getRouter,
  navigateTo,
  prefetch,
  pushState,
  readPageState,
  replaceState,
} from "./client/spa-router";
export { installChunkErrorRecovery, isChunkLoadError } from "./client/chunk-recovery";
export { createClientPluginManager, FarmClientPluginManager } from "./client/plugin";
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
} from "./client/link";
export type { FarmChunkRecoveryOptions } from "./client/chunk-recovery";
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
} from "./client/plugin";
export type { UseBlockerOptions, UseBlockerReturn, UseRouterOptions } from "./client/router";
export type {
  FarmNavigateOptions,
  FarmNavigationBlocker,
  FarmNavigationBlockerContext,
  FarmNavigationListener,
  FarmNavigationLocation,
  FarmNavigationState,
  FarmViewTransitionMode,
} from "./client/spa-router";
