import {
  defineIntegration,
  type FarmIntegrationHandlerContext,
  type FarmIntegrationLogger,
  type FarmIntegrationRouteMethod,
} from "@farm.js/core/integrations";

// Client API helpers live in the browser-safe `./client` entry. Re-export them so
// existing server-side imports from `@farm.js/integration-utils/integration` keep working.
export {
  createPathInferredClientApi,
  type InferPathInferredClientAPI,
  type PathInferredClientOperation,
} from "./client.js";

export interface AuthRouteIntegrationConfig<TInstance> {
  type: string;
  instance: TInstance;
  log?: FarmIntegrationLogger;
  path: string;
  methods: FarmIntegrationRouteMethod[];
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
