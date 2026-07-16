import {
  defineIntegration,
  endpoint,
  type FarmIntegrationHandlerContext,
  type FarmIntegrationLogger,
  integrationRoute,
} from "@farmjs/core";

export interface LocalDemoIntegrationOptions {
  greeting?: string;
  log?: FarmIntegrationLogger;
}

export type LocalDemoStatusResult = {
  ok: true;
  integration: {
    category: string;
    type: string;
  };
  message: string;
  pathname: string;
  requestId: string;
  bootedAt: string;
  lastAction: unknown;
  middlewareOrder: string[];
  timestamp: string;
};

export type LocalDemoEchoInput = {
  message: string;
};

export type LocalDemoEchoResult = {
  ok: true;
  message: string;
  uppercase: string;
  length: number;
  pathname: string;
  requestId: string;
  lastAction: string;
  middlewareOrder: string[];
  timestamp: string;
};

type LocalDemoInstance = {
  bootedAt: string;
  greeting: string;
};

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
  } catch {
    // Keep invalid payloads as empty input for a consistent error response.
  }

  return {};
}

function createStatusResponse(
  context: FarmIntegrationHandlerContext,
  instance: LocalDemoInstance,
) {
  return Response.json({
    ok: true,
    integration: {
      category: context.integration.category,
      type: context.integration.type,
    },
    message: instance.greeting,
    pathname: context.pathname,
    requestId: context.requestId,
    bootedAt: instance.bootedAt,
    lastAction: context.req.get("local-demo:last-action"),
    middlewareOrder:
      context.req.get<string[]>("local-demo:middleware-order") || [],
    timestamp: new Date().toISOString(),
  });
}

function appendMiddlewareStep(
  context: FarmIntegrationHandlerContext,
  step: string,
) {
  const current =
    context.req.get<string[]>("local-demo:middleware-order") || [];
  context.req.set("local-demo:middleware-order", [...current, step]);
}

export const localDemoRoutes = [
  integrationRoute.get<
    "/api/local-demo/message",
    LocalDemoStatusResult
  >("/api/local-demo/message", {
    responseFormat: "json",
    middleware: [
      {
        handler(_request, context) {
          context.req.set("local-demo:last-action", "status");
          appendMiddlewareStep(context, "status:first");
        },
      },
      {
        handler(_request, context) {
          const lists = context.req.get<string[]>("local-demo:middleware-order") || [];
          appendMiddlewareStep(context, "status:second");
        },
      },
    ],
    handler(_request, context) {
      return createStatusResponse(context, {
        bootedAt:
          (context.integration.instance as LocalDemoInstance).bootedAt,
        greeting:
          (context.integration.instance as LocalDemoInstance).greeting,
      });
    },
  }),
  integrationRoute.post<
    "/api/local-demo/message",
    LocalDemoEchoInput,
    LocalDemoEchoResult
  >("/api/local-demo/message", {
    responseFormat: "json",
    middleware: [
      {
        handler(_request, context) {
          context.req.set("local-demo:last-action", "echo");
          appendMiddlewareStep(context, "echo:first");
        },
      },
      {
        handler(_request, context) {
          appendMiddlewareStep(context, "echo:second");
        },
      },
    ],
    async handler(request, context) {
      const body = await readJsonBody(request);
      const message = typeof body.message === "string" ? body.message.trim() : "";

      if (!message) {
        return Response.json(
          {
            error: "Message is required.",
          },
          {
            status: 400,
          },
        );
      }

      context.req.set("local-demo:last-message", message);
      return Response.json({
        ok: true,
        message,
        uppercase: message.toUpperCase(),
        length: message.length,
        pathname: context.pathname,
        requestId: context.requestId,
        lastAction: context.req.get("local-demo:last-action"),
        middlewareOrder:
          context.req.get<string[]>("local-demo:middleware-order") || [],
        timestamp: new Date().toISOString(),
      });
    },
  }),
] as const;

export function localDemo(options: LocalDemoIntegrationOptions = {}) {
  const instance: LocalDemoInstance = {
    bootedAt: new Date().toISOString(),
    greeting:
      options.greeting || "This route is served by an app-local integration defined inside the example.",
  };

  return defineIntegration({
    category: "custom",
    type: "local-demo",
    instance,
    api: endpoint.fromRoutes(localDemoRoutes),
    log: options.log,
    routes: localDemoRoutes,
  });
}
