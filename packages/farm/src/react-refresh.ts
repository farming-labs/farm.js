import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Plugin, PluginOption, ResolvedConfig, UserConfig } from "vite";

/**
 * React Fast Refresh for Farm's development server.
 *
 * `@vitejs/plugin-react` owns the transform (Vite's built-in Oxc refresh
 * transform plus the native refresh wrapper) and serves `/@react-refresh`.
 * Farm renders its own document, so Vite's `transformIndexHtml` preamble never
 * runs; the client entry imports the preamble instead, before React loads.
 */

const REACT_REFRESH_PLUGIN = "vite:react-refresh";
const FARM_REACT_REFRESH_PREAMBLE_ID = "/@farm/react-refresh-preamble";
const FARM_OWNED = Symbol.for("farm.react-refresh.owned");

/** Whether a plugin-react instance in this config serves Fast Refresh for the browser. */
export function isFarmReactRefreshActive(config: ResolvedConfig): boolean {
  return (
    config.command === "serve" &&
    !config.isProduction &&
    config.server.hmr !== false &&
    config.plugins.some((plugin) => plugin.name === REACT_REFRESH_PLUGIN)
  );
}

function isFarmClientEntryId(id: string): boolean {
  const pathname = id.split("?", 1)[0];
  return pathname === "/@farm/client" || pathname === "/@farm/client.js";
}

/** An app that registers its own plugin-react keeps it; Farm then only adds the preamble. */
function hasAppReactPlugin(plugins: UserConfig["plugins"]): boolean {
  const pending: PluginOption[] = [...(plugins ?? [])];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (Array.isArray(entry)) {
      pending.push(...entry);
      continue;
    }
    if (!entry || typeof entry !== "object" || "then" in entry) continue;
    if (entry.name === REACT_REFRESH_PLUGIN && !(FARM_OWNED in entry)) return true;
  }
  return false;
}

function createFarmReactRefreshPreamblePlugin(): Plugin {
  let active = false;
  return {
    name: "farm:react-refresh-preamble",
    apply: "serve",
    configResolved(config) {
      active = isFarmReactRefreshActive(config);
    },
    resolveId(id) {
      if (id === FARM_REACT_REFRESH_PREAMBLE_ID) return id;
    },
    load(id) {
      if (id !== FARM_REACT_REFRESH_PREAMBLE_ID) return;
      if (!active) return "";
      // The runtime must hook into React before react-dom evaluates, so this
      // runs as its own module ahead of every other client entry import.
      return `import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
`;
    },
    transform(code, id) {
      if (!active || this.environment?.config.consumer !== "client" || !isFarmClientEntryId(id)) {
        return;
      }
      return {
        code: `import ${JSON.stringify(FARM_REACT_REFRESH_PREAMBLE_ID)};\n${code}`,
        map: null,
      };
    },
  };
}

/** Core's own `@vitejs/plugin-react`, for apps that do not install it. */
export async function loadFarmReactPlugin(): Promise<typeof import("@vitejs/plugin-react")> {
  // Resolved at runtime rather than imported: production servers bundle core,
  // and a traceable import would ship plugin-react, Vite and Rolldown with them.
  const entry = createRequire(
    typeof __filename === "string" ? __filename : import.meta.url,
  ).resolve("@vitejs/plugin-react");
  return (await import(
    /* @vite-ignore */ pathToFileURL(entry).href
  )) as typeof import("@vitejs/plugin-react");
}

/** Development-only plugins that give React apps Fast Refresh. */
export async function createFarmReactRefreshPlugins(): Promise<Plugin[]> {
  const { default: react } = await loadFarmReactPlugin();
  const plugins = react().map(
    (plugin): Plugin =>
      Object.assign(
        {
          ...plugin,
          apply: (config: UserConfig, env: { command: string }) =>
            env.command === "serve" && !hasAppReactPlugin(config.plugins),
        },
        { [FARM_OWNED]: true },
      ),
  );
  return [...plugins, createFarmReactRefreshPreamblePlugin()];
}
