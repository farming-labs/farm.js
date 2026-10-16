import type { Plugin, PluginOption } from "vite";
import { isReactRenderer, type FarmRenderer } from "../renderer";

const preambleId = "/@farm/react-refresh";

async function hasReactRefreshPlugin(options: PluginOption[]): Promise<boolean> {
  for (const option of options) {
    const plugin = await option;
    if (Array.isArray(plugin)) {
      if (await hasReactRefreshPlugin(plugin)) return true;
    } else if (plugin && plugin.name === "vite:react-refresh") {
      return true;
    }
  }
  return false;
}

/** React's development refresh transport, separate from production renderer plugins. */
export async function createFarmReactRefreshPlugins(
  renderer: FarmRenderer,
  userPlugins: PluginOption[] = [],
): Promise<Plugin[]> {
  if (!isReactRenderer(renderer)) return [];
  // An app-supplied integration owns both its transform and matching preamble.
  // Mixing our plugin version's preamble with its runtime can break that setup.
  if (await hasReactRefreshPlugin(userPlugins)) return [];
  const { default: react } = await import("@vitejs/plugin-react");
  let base = "/";
  let enabled = true;
  const plugins = react().map((plugin): Plugin => {
    if (plugin.name !== "vite:react-babel" || !plugin.transform) return plugin;
    const transform = plugin.transform;
    const handler = typeof transform === "function" ? transform : transform.handler;
    return {
      ...plugin,
      // Farm must consume "use client" and wrap isolated boundaries before
      // Refresh adds imports ahead of the original directive prologue.
      enforce: "post",
      async transform(code, id, options) {
        // Islands have a renderer-neutral updateModule lifecycle. Refresh's
        // export validation must not invalidate their generated metadata.
        if (this.getModuleInfo(id)?.meta?.farmIsolatedClientBoundary) return null;
        return handler.call(this, code, id, options);
      },
    };
  });
  return [
    ...plugins,
    {
      name: "farm:react-refresh-preamble",
      apply: "serve",
      configResolved(config) {
        base = config.base;
        enabled = !config.isProduction && config.server.hmr !== false;
      },
      resolveId(id) {
        if (id === preambleId) return preambleId;
      },
      load(id) {
        if (id === preambleId) return enabled ? react.preambleCode.replace("__BASE__", base) : "";
      },
      transform(code, id, options) {
        if (options?.ssr || !enabled) return null;
        const cleanId = id.split("?", 1)[0];
        if (cleanId !== "/@farm/client" && cleanId !== "/@farm/client.js") return null;
        // Farm renders HTML itself. Load Vite's preamble before React DOM and
        // route imports rather than relying on transformIndexHtml being called.
        return { code: `import ${JSON.stringify(preambleId)};\n${code}`, map: null };
      },
    },
  ];
}
