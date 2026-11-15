import {
  formatOptionalPeerInstallHint,
  isMissingPackageError,
  withOptionalPeerCause,
} from "../optional-peer";

type FarmingLabsDocs = typeof import("@farming-labs/docs");
type FarmingLabsDocsServer = typeof import("@farming-labs/docs/server");

/** The parts of `@farming-labs/docs` the docs runtime renders with. */
export type FarmDocsEngine = FarmingLabsDocs;

type FarmDocsOpenApiDiscovery = FarmingLabsDocsServer["resolveApiReferenceOpenApiDiscovery"];

export const FARMING_LABS_DOCS_INSTALL_HINT = formatOptionalPeerInstallHint(
  "@farming-labs/docs",
  "use the docs engine",
);

let engine: FarmDocsEngine | undefined;
let loading: Promise<FarmDocsEngine> | undefined;
let loadingOpenApiDiscovery: Promise<FarmDocsOpenApiDiscovery> | undefined;

/**
 * `@farming-labs/docs` is an optional peer of @farm.js/core. Load it once,
 * with literal imports so bundlers can trace it, when docs are enabled.
 */
export function loadFarmDocsEngine(): Promise<FarmDocsEngine> {
  loading ??= import("@farming-labs/docs").then(
    (docs) => {
      engine = docs;
      return engine;
    },
    (error: unknown) => {
      loading = undefined;
      throw docsEngineLoadError(error);
    },
  );
  return loading;
}

/**
 * `@farming-labs/docs/server`'s API reference discovery, which the agent discovery documents use.
 * It loads on the first of those requests: the module also brings the docs MCP server and the
 * OpenAPI tooling, which nothing else needs at startup.
 */
export function loadFarmDocsOpenApiDiscovery(): Promise<FarmDocsOpenApiDiscovery> {
  loadingOpenApiDiscovery ??= import("@farming-labs/docs/server").then(
    (server) => server.resolveApiReferenceOpenApiDiscovery,
    (error: unknown) => {
      loadingOpenApiDiscovery = undefined;
      throw docsEngineLoadError(error);
    },
  );
  return loadingOpenApiDiscovery;
}

function docsEngineLoadError(error: unknown): unknown {
  if (!isMissingPackageError(error, "@farming-labs/docs")) return error;
  return withOptionalPeerCause(
    new Error(
      `docs is enabled, but @farming-labs/docs is not installed. ${FARMING_LABS_DOCS_INSTALL_HINT}`,
    ),
    error,
  );
}

/** The loaded engine. Every docs entry point awaits `loadFarmDocsEngine()` first. */
export function docsEngine(): FarmDocsEngine {
  if (!engine) {
    throw new Error("Farm docs engine was used before loadFarmDocsEngine() resolved.");
  }
  return engine;
}
