import { defineIntegration, type FarmIntegrationLogger } from "@farmjs/core";

export interface BetterAuthInstance {
  handler(request: Request): Promise<Response> | Response;
}

export interface BetterAuthIntegrationInput {
  instance: BetterAuthInstance;
  log?: FarmIntegrationLogger;
}

export function betterAuth(input: BetterAuthIntegrationInput) {
  return defineIntegration({
    slot: "auth",
    type: "better-auth",
    instance: input.instance,
    log: input.log,
    routes: [
      {
        path: "/api/auth/[...auth]",
        methods: ["GET", "POST"],
        handler(request: Request) {
          return input.instance.handler(request);
        },
      },
    ],
  });
}
