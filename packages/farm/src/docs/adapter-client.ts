/**
 * The client half of a docs runtime adapter, written into the generated client
 * entry. The adapter's React module is imported only on pages the docs server
 * rendered, which set `window.__FARM_DOCS_ADAPTER__`. An adapter can bundle
 * every docs page with it, so importing it statically would make every other
 * page of the app download all of them.
 */
export function generateFarmDocsAdapterClientRuntime(reactModule: string | undefined): string {
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
  const FarmDocsAdapterReact = await import(${JSON.stringify(reactModule)});
  if (typeof FarmDocsAdapterReact.hydrateFarmDocs !== "function") {
    throw new Error("The configured Farm docs adapter does not export hydrateFarmDocs().");
  }
  FarmDocsAdapterReact.hydrateFarmDocs({
    config: runtime.config || {},
    data: runtime.data,
  });
  return true;
}
`;
}
