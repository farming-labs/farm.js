import type { FarmLayoutFonts } from "../font";
import { resolveFarmDocsContentDir } from "./handler";
import type { FarmDocsResolvedConfig } from "./types";

interface FarmDocsAdapterServerModule {
  createFarmDocsRuntimeHandler?: (
    config: Record<string, unknown>,
    options: {
      rootDir: string;
      clientEntry: string;
      stylesheets: string[];
      resolveLayoutFonts?: (
        pathname: string,
      ) => FarmLayoutFonts | undefined | Promise<FarmLayoutFonts | undefined>;
      loadReactModule?: () => Promise<any>;
    },
  ) => (request: Request) => Promise<Response | null>;
}

export interface FarmDocsAdapterHandlerOptions {
  root: string;
  srcDir?: string;
  clientEntry: string;
  fontStylesheetHref?: string;
  globalStylesheetHref?: string;
  resolveLayoutFonts?: (
    pathname: string,
  ) => FarmLayoutFonts | undefined | Promise<FarmLayoutFonts | undefined>;
  loadModule: (specifier: string) => Promise<any>;
}

export function hasFarmDocsRuntimeAdapter(
  docs: FarmDocsResolvedConfig | undefined,
): docs is FarmDocsResolvedConfig & { adapter: NonNullable<FarmDocsResolvedConfig["adapter"]> } {
  return Boolean(docs?.enabled && docs.adapter?.server && docs.adapter.react);
}

/**
 * Load a documentation runtime through the versioned adapter descriptor.
 *
 * Core deliberately knows nothing about the adapter's DOM or theme. It only
 * supplies host assets and Vite's module loader; the adapter returns the final
 * Web Request handler.
 */
export async function createFarmDocsAdapterHandler(
  docs: FarmDocsResolvedConfig,
  options: FarmDocsAdapterHandlerOptions,
): Promise<(request: Request) => Promise<Response | null>> {
  if (!hasFarmDocsRuntimeAdapter(docs)) {
    throw new Error("Farm docs adapter requires server and react runtime entrypoints.");
  }

  const serverModule = (await options.loadModule(
    docs.adapter.server,
  )) as FarmDocsAdapterServerModule;
  if (typeof serverModule.createFarmDocsRuntimeHandler !== "function") {
    const adapterId = JSON.stringify(docs.adapter.id);
    const serverEntry = JSON.stringify(docs.adapter.server);
    throw new Error(
      `Farm docs adapter ${adapterId} does not export createFarmDocsRuntimeHandler from ${serverEntry}. ` +
        "Upgrade the adapter to a runtime-enabled release.",
    );
  }

  const runtimeConfig = {
    ...docs.config,
    entry: docs.config.entry || docs.entry.replace(/^\/+|\/+$/g, "") || "docs",
    docsPath: docs.entry,
    contentDir: resolveFarmDocsContentDir(docs, {
      root: options.root,
      srcDir: options.srcDir,
    }),
  };

  return serverModule.createFarmDocsRuntimeHandler(runtimeConfig as Record<string, unknown>, {
    rootDir: options.root,
    clientEntry: options.clientEntry,
    stylesheets: [options.fontStylesheetHref, options.globalStylesheetHref].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
    resolveLayoutFonts: options.resolveLayoutFonts,
    loadReactModule: () => options.loadModule(docs.adapter.react!),
  });
}
