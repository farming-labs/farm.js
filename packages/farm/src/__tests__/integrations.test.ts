import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import { PluginManager } from "../plugin";
import {
  defineIntegration,
  getIntegrationDocumentNavigationMatchers,
  resolveIntegrationPlugins,
} from "../integrations";

function createManager() {
  return new PluginManager({
    config: {},
    isDev: true,
    isProd: false,
  });
}

function createRequest(url: string, method = "GET") {
  const req = new EventEmitter() as EventEmitter & {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  req.url = url;
  req.method = method;
  req.headers = {
    host: "localhost:3000",
    "x-request-id": "req-1",
  };
  return req;
}

function createResponse() {
  const headers = new Map<string, string | string[]>();
  return {
    statusCode: 200,
    writableEnded: false,
    body: Buffer.alloc(0),
    setHeader(key: string, value: string | string[]) {
      headers.set(key, value);
    },
    getHeader(key: string) {
      return headers.get(key);
    },
    end(value?: Buffer | string) {
      this.writableEnded = true;
      if (typeof value === "string") {
        this.body = Buffer.from(value);
        return;
      }
      this.body = value || Buffer.alloc(0);
    },
  };
}

describe("integrations runtime", () => {
  it("normalizes legacy slot inputs to category", () => {
    const integration = defineIntegration({
      slot: "auth",
      type: "legacy-auth",
      instance: {},
    });

    expect(integration.category).toBe("auth");
    expect(integration.slot).toBe("auth");
  });

  it("registers route integrations as pre-plugins and exposes shared handler context", async () => {
    const log = vi.fn();
    const manager = createManager();
    manager.addPlugin({
      name: "seed-request-context",
      enforce: "pre",
      beforeRequest(req, _res, context) {
        context.requestContext.set(req, "seed", "shared-value");
      },
    });
    manager.addPlugins(
      resolveIntegrationPlugins({
        auth: defineIntegration({
          category: "auth",
          type: "better-auth",
          instance: {
            handler: vi.fn(),
          },
          log,
          routes: [
            {
              path: "/api/auth/[provider]/[...auth]",
              methods: ["GET", "POST"],
              handler(request, context) {
                expect(context.request).toBe(request);
                expect(context.requestId).toBe("req-1");
                expect(context.pathname).toBe("/api/auth/github/callback");
                expect(context.params).toEqual({
                  provider: "github",
                  auth: ["callback"],
                });
                expect(context.integration.category).toBe("auth");
                expect(context.integration.slot).toBe("auth");
                expect(context.integration.type).toBe("better-auth");
                expect(context.route.kind).toBe("route");
                expect(context.requestContext.get("seed")).toBe("shared-value");

                context.requestContext.set("handled", "yes");

                return Response.json(
                  {
                    provider: context.params.provider,
                    auth: context.params.auth,
                    handled: context.requestContext.get("handled"),
                    seeded: context.requestContext.get("seed"),
                  },
                  { status: 201 },
                );
              },
            },
          ],
        }),
      }),
    );

    await manager.runHookParallel("init");

    const req = createRequest("/api/auth/github/callback");
    const res = createResponse();
    const ended = await manager.runHookParallel("beforeRequest", req as any, res as any);

    expect(ended).toBe(true);
    expect(res.writableEnded).toBe(true);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body.toString())).toEqual({
      provider: "github",
      auth: ["callback"],
      handled: "yes",
      seeded: "shared-value",
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "registered",
        route: expect.objectContaining({
          path: "/api/auth/[provider]/[...auth]",
        }),
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "request:start",
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "request:end",
        durationMs: expect.any(Number),
        context: expect.any(Map),
      }),
    );
    const endLog = log.mock.calls.find((call) => call[0]?.phase === "request:end")?.[0];
    expect(endLog?.context.get("handled")).toBe("yes");
    expect(endLog?.context.get("seed")).toBe("shared-value");
  });

  it("runs integration middleware before routes and can short-circuit the request", async () => {
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        auth: defineIntegration({
          category: "auth",
          type: "clerk",
          instance: {},
          middleware: [
            {
              matcher: "/dashboard/[section]",
              handler(_request, context) {
                expect(context.route.kind).toBe("middleware");
                expect(context.params).toEqual({
                  section: "settings",
                });
                return new Response("blocked", { status: 401 });
              },
            },
          ],
        }),
      }),
    );

    const req = createRequest("/dashboard/settings");
    const res = createResponse();
    const ended = await manager.runHookParallel("beforeRequest", req as any, res as any);

    expect(ended).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(res.body.toString()).toBe("blocked");
  });

  it("collects document navigation matchers from integrations", () => {
    const matchers = getIntegrationDocumentNavigationMatchers({
      auth: defineIntegration({
        category: "auth",
        type: "clerk",
        instance: {},
        documentNavigations: [
          {
            matcher: ["/sign-in(.*)", "/sign-up(.*)"],
          },
        ],
      }),
    });

    expect(matchers).toEqual(["/sign-in(.*)", "/sign-up(.*)"]);
  });

  it("supports custom integration slots outside the built-in categories", async () => {
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: defineIntegration({
          category: "custom",
          type: "local-demo",
          instance: {
            greeting: "hello",
          },
          routes: [
            {
              path: "/api/local-demo/status",
              methods: ["GET"],
              handler(_request, context) {
                return Response.json({
                  slot: context.integration.slot,
                  category: context.integration.category,
                  type: context.integration.type,
                  greeting: (context.integration.instance as { greeting: string }).greeting,
                });
              },
            },
          ],
        }),
      }),
    );

    const req = createRequest("/api/local-demo/status");
    const res = createResponse();
    const ended = await manager.runHookParallel("beforeRequest", req as any, res as any);

    expect(ended).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body.toString())).toEqual({
      slot: "custom",
      category: "custom",
      type: "local-demo",
      greeting: "hello",
    });
  });
});
