import { defineIntegration, type FarmIntegrationLogger } from "@farmjs/core";

export interface AuthRouteIntegrationConfig<TInstance> {
  type: string;
  instance: TInstance;
  log?: FarmIntegrationLogger;
  path: string;
  methods: string[];
  handler: (request: Request, instance: TInstance) => Promise<Response> | Response;
}

export function createAuthRouteIntegration<TInstance>(
  config: AuthRouteIntegrationConfig<TInstance>,
) {
  return defineIntegration({
    slot: "auth",
    type: config.type,
    instance: config.instance,
    log: config.log,
    routes: [
      {
        path: config.path,
        methods: config.methods,
        handler(request: Request) {
          return config.handler(request, config.instance);
        },
      },
    ],
  });
}

export function methodNotAllowed(allow: readonly string[]): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: {
      Allow: allow.join(", "),
    },
  });
}
