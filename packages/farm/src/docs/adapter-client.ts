/**
 * The client half of a docs runtime adapter, written into the generated client
 * entry. The adapter's React module is imported only on pages the docs server
 * rendered, which set `window.__FARM_DOCS_ADAPTER__`. An adapter can bundle
 * every docs page with it, so importing it statically would make every other
 * page of the app download all of them.
 */
/**
 * The app's docs config module, for an adapter that renders what JSON cannot carry from it
 * (icons, MDX components, callbacks). A JSON config has nothing of the sort.
 */
export function getFarmDocsAdapterConfigModule(
  docs: { enabled?: boolean; adapter?: { react?: string }; configPath?: string } | undefined,
): string | undefined {
  if (!docs?.enabled || !docs.adapter?.react || !docs.configPath) return undefined;
  return docs.configPath.endsWith(".json") ? undefined : docs.configPath.replace(/\\/g, "/");
}

export function generateFarmDocsAdapterClientRuntime(
  reactModule: string | undefined,
  configModule?: string,
): string {
  if (!reactModule) {
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
  const [FarmDocsAdapterReact, configModule] = await Promise.all([
    import(${JSON.stringify(reactModule)}),
    runtime.configModule ? ${configModule ? `import(${JSON.stringify(configModule)})` : "undefined"} : undefined,
  ]);
  if (typeof FarmDocsAdapterReact.hydrateFarmDocs !== "function") {
    throw new Error("The configured Farm docs adapter does not export hydrateFarmDocs().");
  }
  FarmDocsAdapterReact.hydrateFarmDocs({
    config: runtime.config || {},
    data: runtime.data,
    ...(configModule ? { configModule: configModule.default ?? configModule } : {}),
  });
  return true;
}
`;
}
