import type { FarmIntegrationLogger } from "@farm.js/core";
import { createAuthRouteIntegration, methodNotAllowed } from "../utils/index.js";

type AuthJsMethod = "GET" | "POST";

export interface AuthJsHandlerSet {
  GET?: (request: Request) => Promise<Response> | Response;
  POST?: (request: Request) => Promise<Response> | Response;
}

export interface AuthJsInstance {
  handlers: AuthJsHandlerSet;
}

export interface AuthJsIntegrationInput {
  instance: AuthJsInstance;
  log?: FarmIntegrationLogger;
}

export function authjs(input: AuthJsIntegrationInput) {
  return createAuthRouteIntegration({
    type: "authjs",
    instance: input.instance,
    log: input.log,
    path: "/api/auth/[...nextauth]",
    methods: ["GET", "POST"],
    async handler(request: Request) {
      const method = request.method.toUpperCase() as AuthJsMethod;
      const handler = input.instance.handlers[method];

      if (!handler) {
        return methodNotAllowed(["GET", "POST"]);
      }

      return await handler(request);
    },
  });
}
