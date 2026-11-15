import type {
  build as viteBuild,
  createServer as createViteServer,
  loadEnv as viteLoadEnv,
} from "vite";

export type FarmProductionViteBuilder = "rolldown";

export interface FarmProductionViteRuntime {
  build: typeof viteBuild;
  createServer: typeof createViteServer;
  loadEnv: typeof viteLoadEnv;
  builder: FarmProductionViteBuilder;
}

function assertRequestedProductionViteBuilder(): void {
  const requested = process.env.FARM_VITE_BUILDER?.trim().toLowerCase();
  if (!requested || requested === "rolldown") return;
  if (requested === "rollup") {
    throw new Error(
      "FARM_VITE_BUILDER=rollup is no longer supported: Farm builds with Vite 8, which bundles with Rolldown. Remove FARM_VITE_BUILDER.",
    );
  }
  throw new Error('FARM_VITE_BUILDER must be "rolldown" when set');
}

/** Load the Vite runtime Farm uses for development, route discovery, and production bundles. */
export async function loadFarmProductionVite(): Promise<FarmProductionViteRuntime> {
  assertRequestedProductionViteBuilder();
  const runtime = await import("vite");
  return {
    build: runtime.build,
    createServer: runtime.createServer,
    loadEnv: runtime.loadEnv,
    builder: "rolldown",
  };
}
