/**
 * Reads a docs adapter descriptor. No Node.js imports, so the dev server, the production build,
 * and config resolution share it.
 */
import type { FarmDocsAdapterDescriptor, FarmDocsResolvedConfig } from "./types";

/** The adapter's UI module: `ui`, or `react` from a descriptor written before `ui` existed. */
export function getFarmDocsAdapterUIModule(
  adapter: Pick<FarmDocsAdapterDescriptor, "ui" | "react"> | undefined,
): string | undefined {
  return adapter?.ui || adapter?.react || undefined;
}

/** The renderer the adapter's UI is written for. A descriptor that names none has a React UI. */
export function getFarmDocsAdapterRenderer(
  adapter: Pick<FarmDocsAdapterDescriptor, "renderer">,
): string {
  return adapter.renderer || "react";
}

export function hasFarmDocsRuntimeAdapter(
  docs: FarmDocsResolvedConfig | undefined,
): docs is FarmDocsResolvedConfig & { adapter: NonNullable<FarmDocsResolvedConfig["adapter"]> } {
  return Boolean(docs?.enabled && docs.adapter?.server && getFarmDocsAdapterUIModule(docs.adapter));
}

/**
 * The app's Vite pipeline compiles the adapter's UI and the docs config module with the app
 * renderer's JSX and file formats, so an adapter runs only under the renderer its UI is written
 * for. Stop on any other renderer instead of serving docs pages that cannot compile or hydrate.
 */
export function assertFarmDocsAdapterRenderer(
  docs: FarmDocsResolvedConfig | undefined,
  renderer: string,
): void {
  if (!hasFarmDocsRuntimeAdapter(docs)) return;
  const adapterRenderer = getFarmDocsAdapterRenderer(docs.adapter);
  if (adapterRenderer === renderer) return;
  throw new Error(
    `The docs adapter ${JSON.stringify(docs.adapter.id)} has a ${JSON.stringify(adapterRenderer)} ` +
      `UI, and this app's renderer is ${JSON.stringify(renderer)}. An adapter runs only under the ` +
      `renderer its UI is written for: use an adapter release with a ${JSON.stringify(renderer)} ` +
      "UI, or remove the adapter (for @farming-labs/farmjs, the withDocs() wrapper) to serve " +
      "docs with Farm's built-in renderer.",
  );
}
