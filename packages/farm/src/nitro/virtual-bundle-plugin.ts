import type { Plugin } from "vite";
import type { OutputBundle } from "rollup";
import { resolve, dirname, basename } from "path";

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

        // Store under multiple keys for flexible resolution
        _modules.set(fileName, virtualModule);
        _modules.set(`./${fileName}`, virtualModule);
        _modules.set(resolve(fileName), virtualModule);
        
        // Also store without extension for flexibility
        const baseName = fileName.replace(/\.[^.]+$/, "");
        _modules.set(baseName, virtualModule);
        _modules.set(`./${baseName}`, virtualModule);
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
        return { id: resolve(id), moduleSideEffects: false };
      }

      // Try with .js extension
      if (!id.endsWith(".js")) {
        const withJs = `${id}.js`;
        if (modules.has(withJs)) {
          return { id: resolve(withJs), moduleSideEffects: false };
        }
      }

      // Relative import resolution
      if (importer) {
        const resolved = resolve(dirname(importer), id);
        if (modules.has(resolved)) {
          return { id: resolved, moduleSideEffects: false };
        }
        
        // Try basename match
        const base = basename(id);
        if (modules.has(base)) {
          return { id: resolve(base), moduleSideEffects: false };
        }
      }

      return null;
    },
    load(id) {
      const modules = getModules();
      
      // Try multiple variations
      const variations = [
        id,
        basename(id),
        `./${basename(id)}`,
        id.replace(/^.*\//, ""),
      ];
      
      for (const variant of variations) {
        const m = modules.get(variant);
        if (m) {
          return {
            code: m.code,
            map: m.map,
          };
        }
      }

      return null;
    },
  };
}
