import type { FarmPlugin, FarmPluginIntegrationContext } from "./plugin";

const FARM_PLUGIN_INTEGRATION_CONTEXT = Symbol.for("@farm.js/core/plugin-integration-context");

export function setFarmPluginIntegrationContext(
  plugin: FarmPlugin,
  integration: Readonly<FarmPluginIntegrationContext>,
): void {
  Object.defineProperty(plugin, FARM_PLUGIN_INTEGRATION_CONTEXT, {
    value: integration,
  });
}

export function getFarmPluginIntegrationContext(
  plugin: FarmPlugin,
): Readonly<FarmPluginIntegrationContext> | undefined {
  const value = (plugin as FarmPlugin & Record<symbol, unknown>)[FARM_PLUGIN_INTEGRATION_CONTEXT];
  return value && typeof value === "object"
    ? (value as Readonly<FarmPluginIntegrationContext>)
    : undefined;
}
