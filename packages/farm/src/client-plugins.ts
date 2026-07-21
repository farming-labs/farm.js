import type { FarmPlugin } from "./plugin";

export {
  createClientPluginManager,
  defineClientPlugin,
  FarmClientPluginManager,
} from "./client/plugin";
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
  FarmClientPluginDefinition,
  FarmClientPluginEnforce,
  FarmClientPluginErrorEvent,
  FarmClientPluginErrorPhase,
  FarmClientPluginFactory,
  FarmClientPluginManagerOptions,
  FarmClientPluginMetadata,
  FarmClientPluginRegistration,
  FarmClientPluginRouter,
  FarmClientPluginSetupEvent,
  FarmClientPluginStateEvent,
} from "./client/plugin";
export type {
  FarmPlugin,
  FarmPluginContext,
  FarmRequestPluginContext,
  FarmRequestStore,
} from "./plugin";

/** @deprecated Define framework plugins from `@farmjs/core` or `@farmjs/core/plugin`. */
export function definePlugin<
  TState = undefined,
  TRequestContext extends object = Record<string, never>,
>(plugin: FarmPlugin<TState, TRequestContext>): FarmPlugin<TState, TRequestContext> {
  return plugin;
}
