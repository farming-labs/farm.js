/**
 * The client half of a docs runtime adapter, written into the generated client
 * entry. The adapter's UI module is imported only on pages the docs server
 * rendered, which set `window.__FARM_DOCS_ADAPTER__`. An adapter can bundle
 * every docs page with it, so importing it statically would make every other
 * page of the app download all of them.
 */
import { getFarmDocsAdapterUIModule } from "./adapter-descriptor";

/**
 * The app's docs config module, for an adapter that renders what JSON cannot carry from it
 * (icons, MDX components, callbacks). A JSON config has nothing of the sort.
 */
export function getFarmDocsAdapterConfigModule(
  docs:
    | { enabled?: boolean; adapter?: { ui?: string; react?: string }; configPath?: string }
    | undefined,
): string | undefined {
  if (!docs?.enabled || !getFarmDocsAdapterUIModule(docs.adapter) || !docs.configPath) {
    return undefined;
  }
  return docs.configPath.endsWith(".json") ? undefined : docs.configPath.replace(/\\/g, "/");
}

/**
 * @param rendererClient The app renderer's client module (`renderer.client`), passed to a UI
 * written for a renderer other than React as `renderer`. A React UI imports React itself.
 */
export function generateFarmDocsAdapterClientRuntime(
  uiModule: string | undefined,
  configModule?: string,
  rendererClient?: string,
): string {
  if (!uiModule) {
    return `
async function hydrateFarmDocsAdapterRuntime() {
  return false;
}
`;
  }

  return `
async function hydrateFarmDocsAdapterRuntime() {
  const runtime = window.__FARM_DOCS_ADAPTER__;
  if (!runtime) return false;
  // The docs server flags pages whose config holds what its JSON copy cannot (icons,
  // MDX components, callbacks); the adapter restores those from the module itself.
  // Fetch it alongside the adapter rather than after it: they don't depend on each other.
  const [FarmDocsAdapterUI, configModule${rendererClient ? ", renderer" : ""}] = await Promise.all([
    import(${JSON.stringify(uiModule)}),
    runtime.configModule ? ${configModule ? `import(${JSON.stringify(configModule)})` : "undefined"} : undefined,${
      rendererClient
        ? `
    import(${JSON.stringify(rendererClient)}),`
        : ""
    }
  ]);
  if (typeof FarmDocsAdapterUI.hydrateFarmDocs !== "function") {
    throw new Error("The configured Farm docs adapter does not export hydrateFarmDocs().");
  }
  FarmDocsAdapterUI.hydrateFarmDocs({
    config: runtime.config || {},
    data: runtime.data,
    ...(configModule ? { configModule: configModule.default ?? configModule } : {}),${
      rendererClient
        ? `
    renderer,`
        : ""
    }
  });
  return true;
}
`;
}
