import { getFarmIntegrationPluginServerRuntime } from "./integrations";
import type { FarmPlugin } from "./plugin";

/** Whether a plugin has hooks the production server runs, so the server must load the config. */
export function hasFarmServerRuntimePlugins(plugins: readonly FarmPlugin[] | undefined): boolean {
  return (plugins || []).some((plugin) => {
    if (getFarmIntegrationPluginServerRuntime(plugin) === false) return false;

    return Boolean(
      plugin.setup ||
      plugin.init ||
      plugin.ready ||
      plugin.shutdown ||
      plugin.runtime ||
      plugin.router ||
      plugin.render ||
      plugin.beforeRouteMatch ||
      plugin.afterRouteMatch ||
      plugin.beforeRender ||
      plugin.afterRender ||
      plugin.onError ||
      plugin.transformHTML,
    );
  });
}
