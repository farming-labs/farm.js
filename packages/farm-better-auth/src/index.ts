import type { FarmIntegrationLogger } from "@farm.js/core";
import { createAuthRouteIntegration } from "@farm.js/integration-utils";

export interface BetterAuthInstance {
  handler(request: Request): Promise<Response> | Response;
  /** Present on every `betterAuth()` instance; Farm reads sessions through it. */
  api?: {
    getSession?(input: { headers: Headers }): Promise<unknown> | unknown;
  };
}

export interface BetterAuthIntegrationInput {
  instance: BetterAuthInstance;
  log?: FarmIntegrationLogger;
}

/** What Farm's session contract reads: the session id, its user, and when it expires. */
export interface BetterAuthIntegrationSession {
  id: string;
  userId?: string;
  expiresAt?: Date;
}

export function betterAuth(input: BetterAuthIntegrationInput) {
  const integration = createAuthRouteIntegration({
    type: "better-auth",
    instance: input.instance,
    log: input.log,
    path: "/api/auth/[...auth]",
    methods: ["GET", "POST"],
    handler(request: Request) {
      return input.instance.handler(request);
    },
  });
  return {
    ...integration,
    /**
     * Who the request's cookies sign in, through Better Auth's `api.getSession`. Mobile session
     * tokens use it to issue and refresh native screens' device tokens.
     */
    async session(request: Request): Promise<BetterAuthIntegrationSession | null> {
      const getSession = input.instance.api?.getSession;
      if (typeof getSession !== "function") return null;
      const result = (await getSession.call(input.instance.api, {
        headers: request.headers,
      })) as { session?: { id?: unknown; userId?: unknown; expiresAt?: unknown } } | null;
      const session = result?.session;
      if (!session || typeof session.id !== "string") return null;
      return {
        id: session.id,
        userId: typeof session.userId === "string" ? session.userId : undefined,
        expiresAt:
          session.expiresAt === undefined
            ? undefined
            : new Date(session.expiresAt as string | number | Date),
      };
    },
  };
}
