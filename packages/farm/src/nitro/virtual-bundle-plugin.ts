import type { Plugin } from "vite";
import type { OutputBundle } from "rollup";
import { resolve, dirname } from "path";

type VirtualModule = { code: string; map: string | null };

/**
 * Virtual bundle plugin - exposes in-memory modules to Nitro
 * This allows Nitro to access the SSR bundle built by Vite without writing to disk
 */
export function virtualBundlePlugin(bundle: OutputBundle): Plugin {
  let _modules: Map<string, VirtualModule> | null = null;

  const getModules = () => {
    if (_modules) {
      return _modules;
    }

    _modules = new Map();

    // Index all chunks from the in-memory bundle
    for (const [fileName, content] of Object.entries(bundle)) {
      if (content.type === "chunk") {
        const virtualModule: VirtualModule = {
          code: content.code,
          map: null,
        };

        // Include source maps if available
        const maybeMap = bundle[`${fileName}.map`];
        if (maybeMap && maybeMap.type === "asset") {
          virtualModule.map = maybeMap.source as string;
        }

        _modules.set(fileName, virtualModule);
        _modules.set(resolve(fileName), virtualModule);
      }
    }

    return _modules;
  };

  return {
    name: "virtual-bundle",
    resolveId(id, importer) {
      const modules = getModules();

      // Direct match
      if (modules.has(id)) {
        return resolve(id);
      }

      // Relative import resolution
      if (importer) {
        const resolved = resolve(dirname(importer), id);
        if (modules.has(resolved)) {
          return resolved;
        }
      }

      return null;
    },
    load(id) {
      const modules = getModules();
      const m = modules.get(id);

      if (!m) {
        return null;
      }

      return {
        code: m.code,
        map: m.map,
      };
    },
  };
}
