import { defineIntegration, type FarmIntegrationLogger } from "@farmjs/core";

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
  return defineIntegration({
    slot: "auth",
    type: "authjs",
    instance: input.instance,
    log: input.log,
    routes: [
      {
        path: "/api/auth/[...nextauth]",
        methods: ["GET", "POST"],
        async handler(request: Request) {
          const method = request.method.toUpperCase() as AuthJsMethod;
          const handler = input.instance.handlers[method];

          if (!handler) {
            return new Response("Method Not Allowed", {
              status: 405,
              headers: {
                Allow: "GET, POST",
              },
            });
          }

          return await handler(request);
        },
      },
    ],
  });
}
