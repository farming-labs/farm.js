import type { ResolvedFarmAuthConfig } from "./types.js";
import {
  configureFarmAuth,
  disposeFarmAuth as runDispose,
  getFarmAuthRuntime,
  migrateFarmAuth as runMigration,
  withFarmAuthClientAddress,
  compileFarmAuthMigration as runCompileMigration,
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
  session(request: Request): Promise<FarmAuthIntegrationSession | null>;
}

interface FarmAuthIntegrationSession {
  id: string;
  userId: string;
  expiresAt: Date;
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
          return runtime.handler(withFarmAuthClientAddress(request));
        },
      },
    ],
    // Farm's session contract: who the request's cookies sign in. Mobile session tokens use it.
    async session(request) {
      const runtime = await getFarmAuthRuntime();
      const result = (await runtime.api.getSession({ headers: request.headers })) as {
        session?: { id?: unknown; userId?: unknown; expiresAt?: unknown };
      } | null;
      const session = result?.session;
      if (!session || typeof session.id !== "string") return null;
      return {
        id: session.id,
        userId: String(session.userId),
        expiresAt: new Date(session.expiresAt as string | number | Date),
      };
    },
  };
}

export async function migrateFarmAuth(): Promise<void> {
  await runMigration();
}

export async function compileFarmAuthMigration(): Promise<string> {
  return runCompileMigration();
}

export async function disposeFarmAuth(): Promise<void> {
  await runDispose();
}
