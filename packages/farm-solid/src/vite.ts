import solidPlugin from "vite-plugin-solid";
import type { PluginOption } from "vite";

export function createFarmRendererPlugin(options: { ssr?: boolean } = {}): PluginOption {
  // `ssr: true` enables hydratable output for both environments; the plugin
  // still selects DOM vs SSR generation from Vite's active environment.
  void options;
  const plugin = solidPlugin({ ssr: true }) as any;
  const configureEnvironment = plugin.configEnvironment;

  // FARMJS can run its compatibility Vite and its Rolldown-powered production
  // Vite in the same installation. vite-plugin-solid normally reads these
  // defaults from its peer Vite, which may be the compatibility version. Seed
  // the active environment explicitly so the plugin remains portable across
  // both builders.
  if (typeof configureEnvironment === "function") {
    plugin.configEnvironment = async function (
      name: string,
      config: { consumer?: string; resolve?: { conditions?: string[] } },
      environmentOptions: { isSsrTargetWebworker?: boolean },
    ) {
      config.resolve ??= {};
      if (config.resolve.conditions == null) {
        const isClient =
          config.consumer === "client" ||
          name === "client" ||
          environmentOptions.isSsrTargetWebworker;
        config.resolve.conditions = isClient
          ? ["module", "browser", "development|production"]
          : ["module", "node", "development|production"];
      }
      return configureEnvironment.call(this, name, config, environmentOptions);
    };
  }

  return plugin;
}
