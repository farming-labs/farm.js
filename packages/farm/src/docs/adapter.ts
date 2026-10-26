import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DocsConfig } from "@farming-labs/docs";
import type { FarmLayoutFonts } from "../font";
import type { FarmMCPServerRegistration } from "../mcp-catalog";
import { getFarmDocsAdapterConfigModule } from "./adapter-client";
import {
  discoverFarmDocsPages,
  getFarmDocsMarkdownPath,
  resolveFarmDocsContentDir,
} from "./handler";
import type { FarmDocsCompiledManifest } from "./precompiled-runtime";
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
      registerMCPServer?: (server: FarmMCPServerRegistration) => () => void;
    },
  ) => (request: Request) => Promise<Response | null>;
}

interface FarmDocsAdapterEdgeCompilerModule {
  compileFarmDocsEdgeManifest?: (
    config: Record<string, unknown>,
    options: {
      rootDir: string;
      clientEntry: string;
      stylesheets: string[];
    },
  ) => FarmDocsCompiledManifest | Promise<FarmDocsCompiledManifest>;
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
  /**
   * Lists the adapter's MCP endpoint in the app's AI catalog. The adapter knows its
   * route, name, and version; older adapters ignore it and older hosts do not pass it.
   */
  registerMCPServer?: (server: FarmMCPServerRegistration) => () => void;
  /** The app's path guards; a guarded docs page refuses the adapter. */
  isPathGuarded?: (pathname: string) => boolean;
}

export interface FarmDocsAdapterEdgeCompileOptions {
  root: string;
  srcDir?: string;
  clientEntry: string;
  fontStylesheetHref?: string;
  globalStylesheetHref?: string;
}

export function hasFarmDocsRuntimeAdapter(
  docs: FarmDocsResolvedConfig | undefined,
): docs is FarmDocsResolvedConfig & { adapter: NonNullable<FarmDocsResolvedConfig["adapter"]> } {
  return Boolean(docs?.enabled && docs.adapter?.server && docs.adapter.react);
}

/**
 * The adapter answers pages, Markdown, llms-full.txt, search, and MCP from its own index
 * and never runs the app's guards, so a docs page behind a path guard would reach anyone.
 * Refuse that pairing instead of serving it.
 */
export function assertFarmDocsAdapterServesNoGuardedPages(
  docs: FarmDocsResolvedConfig | undefined,
  options: { root: string; srcDir?: string },
  isPathGuarded: ((pathname: string) => boolean) | undefined,
): void {
  if (!isPathGuarded || !hasFarmDocsRuntimeAdapter(docs)) return;
  const guarded = discoverFarmDocsPages(resolveFarmDocsContentDir(docs, options), docs)
    .filter((page) => isPathGuarded(page.href) || isPathGuarded(getFarmDocsMarkdownPath(page.href)))
    .map((page) => page.href);
  if (guarded.length === 0) return;
  throw new Error(
    `Docs pages behind a path guard (${guarded.join(", ")}) would be public: the docs adapter ` +
      `${JSON.stringify(docs.adapter.id)} serves their content in llms-full.txt, search, ` +
      "Markdown, and MCP without running the app's guards. Move those pages out of the docs " +
      "content directory, or set docs.adapter = false to use Farm's built-in docs runtime, " +
      "which keeps guarded pages off anonymous surfaces.",
  );
}

/**
 * The docs config module, loaded through the app's module pipeline as the browser loads it,
 * so client components it imports render the same on both sides. Production imports it
 * into the server bundle the same way.
 */
async function loadFarmDocsConfigModule(
  docs: FarmDocsResolvedConfig,
  loadModule: FarmDocsAdapterHandlerOptions["loadModule"],
): Promise<Partial<DocsConfig> | undefined> {
  const configModule = getFarmDocsAdapterConfigModule(docs);
  if (!configModule) return undefined;
  const loaded = (await loadModule(configModule)) as { default?: unknown } | undefined;
  const config = loaded?.default ?? loaded;
  return config && typeof config === "object" ? (config as Partial<DocsConfig>) : undefined;
}

function createFarmDocsAdapterRuntimeConfig(
  docs: FarmDocsResolvedConfig,
  options: { root: string; srcDir?: string },
  moduleConfig?: Partial<DocsConfig>,
): Record<string, unknown> {
  return {
    ...(moduleConfig
      ? { ...moduleConfig, ...docs.configOverrides }
      : (docs.runtimeConfig ?? docs.config)),
    entry: docs.config.entry || docs.entry.replace(/^\/+|\/+$/g, "") || "docs",
    docsPath: docs.entry,
    contentDir: resolveFarmDocsContentDir(docs, options),
  };
}

function getFarmDocsAdapterStylesheets(options: {
  fontStylesheetHref?: string;
  globalStylesheetHref?: string;
}): string[] {
  return [options.fontStylesheetHref, options.globalStylesheetHref].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export async function compileFarmDocsAdapterEdgeManifest(
  docs: FarmDocsResolvedConfig,
  options: FarmDocsAdapterEdgeCompileOptions,
): Promise<FarmDocsCompiledManifest> {
  if (!hasFarmDocsRuntimeAdapter(docs)) {
    throw new Error("Farm docs adapter requires server and react runtime entrypoints.");
  }
  const compilerEntry = docs.adapter.edgeCompiler;
  if (!compilerEntry) {
    throw new Error(
      `Farm docs adapter ${JSON.stringify(docs.adapter.id)} does not declare the edge compiler required for this deployment.`,
    );
  }

  const requireFromApp = createRequire(path.join(options.root, "package.json"));
  let compilerPath: string;
  try {
    compilerPath = requireFromApp.resolve(compilerEntry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Farm docs adapter ${JSON.stringify(docs.adapter.id)} edge compiler ${JSON.stringify(compilerEntry)} could not be resolved from the application: ${message}`,
    );
  }

  const compilerModule = (await import(
    /* @vite-ignore */ pathToFileURL(compilerPath).href
  )) as FarmDocsAdapterEdgeCompilerModule;
  if (typeof compilerModule.compileFarmDocsEdgeManifest !== "function") {
    throw new Error(
      `Farm docs adapter ${JSON.stringify(docs.adapter.id)} does not export compileFarmDocsEdgeManifest from ${JSON.stringify(compilerEntry)}.`,
    );
  }

  const manifest = await compilerModule.compileFarmDocsEdgeManifest(
    createFarmDocsAdapterRuntimeConfig(docs, options),
    {
      rootDir: options.root,
      clientEntry: options.clientEntry,
      stylesheets: getFarmDocsAdapterStylesheets(options),
    },
  );
  if (
    !manifest ||
    manifest.protocol !== 1 ||
    !manifest.routes ||
    typeof manifest.routes !== "object" ||
    !manifest.api ||
    typeof manifest.api !== "object"
  ) {
    throw new Error(
      `Farm docs adapter ${JSON.stringify(docs.adapter.id)} returned an invalid edge manifest.`,
    );
  }
  return manifest;
}

/**
 * Load a documentation runtime through the versioned adapter descriptor.
 *
 * Core deliberately knows nothing about the adapter's DOM or theme. It only
 * supplies host assets, Vite's module loader, and a way to list the adapter's MCP
 * endpoint in the AI catalog; the adapter returns the final Web Request handler.
 */
export async function createFarmDocsAdapterHandler(
  docs: FarmDocsResolvedConfig,
  options: FarmDocsAdapterHandlerOptions,
): Promise<(request: Request) => Promise<Response | null>> {
  if (!hasFarmDocsRuntimeAdapter(docs)) {
    throw new Error("Farm docs adapter requires server and react runtime entrypoints.");
  }
  assertFarmDocsAdapterServesNoGuardedPages(docs, options, options.isPathGuarded);

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

  const runtimeConfig = createFarmDocsAdapterRuntimeConfig(
    docs,
    options,
    await loadFarmDocsConfigModule(docs, options.loadModule),
  );

  return serverModule.createFarmDocsRuntimeHandler(runtimeConfig as Record<string, unknown>, {
    rootDir: options.root,
    clientEntry: options.clientEntry,
    stylesheets: getFarmDocsAdapterStylesheets(options),
    resolveLayoutFonts: options.resolveLayoutFonts,
    loadReactModule: () => options.loadModule(docs.adapter.react!),
    ...(options.registerMCPServer ? { registerMCPServer: options.registerMCPServer } : {}),
  });
}
