import type {
  build as viteBuild,
  createServer as createViteServer,
  loadEnv as viteLoadEnv,
} from "vite";

export type FarmProductionViteBuilder = "rollup" | "rolldown";

export interface FarmProductionViteRuntime {
  build: typeof viteBuild;
  createServer: typeof createViteServer;
  loadEnv: typeof viteLoadEnv;
  builder: FarmProductionViteBuilder;
}

export function canUseRolldownForRouteDiscovery(viteConfig: object | undefined): boolean {
  return !viteConfig || Object.keys(viteConfig).length === 0;
}

export function supportsRolldownVite(nodeVersion = process.versions.node): boolean {
  const [major = 0, minor = 0] = nodeVersion.split(".").map(Number);
  return (major === 20 && minor >= 19) || major > 22 || (major === 22 && minor >= 12);
}

function requestedProductionViteBuilder(): FarmProductionViteBuilder | undefined {
  const requested = process.env.FARM_VITE_BUILDER?.trim().toLowerCase();
  if (!requested) return undefined;
  if (requested === "rollup" || requested === "rolldown") return requested;
  throw new Error('FARM_VITE_BUILDER must be either "rolldown" or "rollup"');
}

async function loadRollupVite(): Promise<FarmProductionViteRuntime> {
  const runtime = await import("vite");
  return {
    build: runtime.build,
    createServer: runtime.createServer,
    loadEnv: runtime.loadEnv,
    builder: "rollup",
  };
}

/**
 * Prefer Vite's Rolldown-powered production builder on supported Node releases.
 * Vite 5 remains the compatibility path for Node 18, --no-optional installs,
 * and projects that explicitly request Rollup.
 */
export async function loadFarmProductionVite(): Promise<FarmProductionViteRuntime> {
  const requested = requestedProductionViteBuilder();
  if (requested === "rollup" || !supportsRolldownVite()) {
    if (requested === "rolldown") {
      throw new Error(
        "FARM_VITE_BUILDER=rolldown requires Node 20.19+, Node 22.12+, or a newer release",
      );
    }
    return loadRollupVite();
  }

  try {
    const runtime = (await import("vite-rolldown")) as unknown as typeof import("vite");
    return {
      build: runtime.build,
      createServer: runtime.createServer,
      loadEnv: runtime.loadEnv,
      builder: "rolldown",
    };
  } catch (error) {
    if (requested === "rolldown") {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(
        `FARM_VITE_BUILDER=rolldown was requested, but the optional Vite Rolldown runtime could not be loaded${detail}`,
      );
    }
    return loadRollupVite();
  }
}
