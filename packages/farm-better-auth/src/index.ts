import type { FarmIntegrationLogger } from "@farm.js/core";
import { createAuthRouteIntegration } from "@farm.js/integration-utils";

export interface BetterAuthInstance {
  handler(request: Request): Promise<Response> | Response;
}

export interface BetterAuthIntegrationInput {
  instance: BetterAuthInstance;
  log?: FarmIntegrationLogger;
}

export function betterAuth(input: BetterAuthIntegrationInput) {
  return createAuthRouteIntegration({
    type: "better-auth",
    instance: input.instance,
    log: input.log,
    path: "/api/auth/[...auth]",
    methods: ["GET", "POST"],
    handler(request: Request) {
      return input.instance.handler(request);
    },
  });
}
