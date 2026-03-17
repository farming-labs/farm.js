import {
  defineIntegration,
  type FarmIntegrationHandlerContext,
  type FarmIntegrationLogger,
} from "@farmjs/core";

export interface AuthRouteIntegrationConfig<TInstance> {
  type: string;
  instance: TInstance;
  log?: FarmIntegrationLogger;
  path: string;
  methods: string[];
  handler: (
    request: Request,
    context: FarmIntegrationHandlerContext,
    instance: TInstance,
  ) => Promise<Response> | Response;
}

export function createAuthRouteIntegration<TInstance>(
  config: AuthRouteIntegrationConfig<TInstance>,
) {
  return defineIntegration({
    category: "auth",
    type: config.type,
    instance: config.instance,
    log: config.log,
    routes: [
      {
        path: config.path,
        methods: config.methods,
        handler(request: Request, context: FarmIntegrationHandlerContext) {
          return config.handler(request, context, config.instance);
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
