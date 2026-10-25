import {
  formatOptionalPeerInstallHint,
  isMissingPackageError,
  withOptionalPeerCause,
} from "../optional-peer";

type FarmingLabsDocs = typeof import("@farming-labs/docs");
type FarmingLabsDocsServer = typeof import("@farming-labs/docs/server");

/** The parts of `@farming-labs/docs` the docs runtime renders with. */
export type FarmDocsEngine = FarmingLabsDocs &
  Pick<FarmingLabsDocsServer, "resolveApiReferenceOpenApiDiscovery">;

export const FARMING_LABS_DOCS_INSTALL_HINT = formatOptionalPeerInstallHint(
  "@farming-labs/docs",
  "use the docs engine",
);

let engine: FarmDocsEngine | undefined;
let loading: Promise<FarmDocsEngine> | undefined;

/**
 * `@farming-labs/docs` is an optional peer of @farm.js/core. Load it once,
 * with literal imports so bundlers can trace it, when docs are enabled.
 */
export function loadFarmDocsEngine(): Promise<FarmDocsEngine> {
  loading ??= Promise.all([import("@farming-labs/docs"), import("@farming-labs/docs/server")]).then(
    ([docs, server]) => {
      engine = {
        ...docs,
        resolveApiReferenceOpenApiDiscovery: server.resolveApiReferenceOpenApiDiscovery,
      };
      return engine;
    },
    (error: unknown) => {
      loading = undefined;
      if (!isMissingPackageError(error, "@farming-labs/docs")) throw error;
      throw withOptionalPeerCause(
        new Error(
          `docs is enabled, but @farming-labs/docs is not installed. ${FARMING_LABS_DOCS_INSTALL_HINT}`,
        ),
        error,
      );
    },
  );
  return loading;
}

/** The loaded engine. Every docs entry point awaits `loadFarmDocsEngine()` first. */
export function docsEngine(): FarmDocsEngine {
  if (!engine) {
    throw new Error("Farm docs engine was used before loadFarmDocsEngine() resolved.");
  }
  return engine;
}
