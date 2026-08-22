import type { ResolvedFarmAuthConfig } from "./types.js";
import {
  configureFarmAuth,
  disposeFarmAuth as runDispose,
  getFarmAuthRuntime,
  migrateFarmAuth as runMigration,
} from "./runtime.js";

interface FarmAuthIntegrationOptions {
  root: string;
  mode: "development" | "production";
}

interface FarmAuthIntegration {
  readonly kind: "farm-integration";
  category: "auth";
  type: "farm-auth";
  instance: { readonly kind: "farm-auth-runtime" };
  routes: Array<{
    path: string;
    methods: readonly ["GET", "POST"];
    handler(request: Request): Promise<Response>;
  }>;
}

export function createFarmAuthIntegration(
  config: ResolvedFarmAuthConfig,
  options: FarmAuthIntegrationOptions,
): FarmAuthIntegration {
  configureFarmAuth(config, options);

  return {
    kind: "farm-integration",
    category: "auth",
    type: "farm-auth",
    instance: Object.freeze({ kind: "farm-auth-runtime" }),
    routes: [
      {
        path: `${config.basePath}/[...auth]`,
        methods: ["GET", "POST"],
        async handler(request) {
          const runtime = await getFarmAuthRuntime();
          return runtime.handler(request);
        },
      },
    ],
  };
}

export async function migrateFarmAuth(): Promise<void> {
  await runMigration();
}

export async function disposeFarmAuth(): Promise<void> {
  await runDispose();
}
