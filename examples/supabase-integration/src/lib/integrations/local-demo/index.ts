import {
  defineIntegration,
  type FarmIntegrationHandlerContext,
  type FarmIntegrationLogger,
} from "@farmjs/core";
import { localDemoClient } from "./client.ts";

export interface LocalDemoIntegrationOptions {
  greeting?: string;
  log?: FarmIntegrationLogger;
}

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
  context.requestContext.set("local-demo:last-action", "status");

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
    lastAction: context.requestContext.get("local-demo:last-action"),
    timestamp: new Date().toISOString(),
  });
}

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
    api: localDemoClient,
    log: options.log,
    routes: [
      {
        path: "/api/local-demo/status",
        methods: ["GET"],
        handler(_request, context) {
          return createStatusResponse(context, instance);
        },
      },
      {
        path: "/api/local-demo/echo",
        methods: ["POST"],
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

          context.requestContext.set("local-demo:last-action", "echo");
          context.requestContext.set("local-demo:last-message", message);

          return Response.json({
            ok: true,
            message,
            uppercase: message.toUpperCase(),
            length: message.length,
            pathname: context.pathname,
            requestId: context.requestId,
            lastAction: context.requestContext.get("local-demo:last-action"),
            timestamp: new Date().toISOString(),
          });
        },
      },
    ],
  });
}
