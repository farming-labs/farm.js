import { EventEmitter } from "events";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { PluginManager } from "../plugin";
import {
  defineIntegration,
  dispatchIntegrationRequest,
  getRegisteredIntegrationRuntime,
  getIntegrationDocumentNavigationMatchers,
  getIntegrationSchemas,
  getRegisteredIntegrationSchemas,
  integrationRoute,
  matchRegisteredIntegrationRoute,
  resolveIntegrationPlugins,
  type FarmIntegrationSchema,
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

  it("preserves optional integration schemas and exposes them through schema helpers", async () => {
    const manager = createManager();
    const schema = {
      models: {
        billingAccount: {
          name: "billing_account",
          fields: {
            id: {
              type: "id",
              primaryKey: true,
            },
            userId: {
              type: "string",
              name: "user_id",
              required: true,
              index: true,
            },
          },
          constraints: [
            {
              type: "unique",
              fields: ["userId"],
            },
          ],
        },
      },
      meta: {
        source: "test",
      },
    } satisfies FarmIntegrationSchema;
    const integration = defineIntegration({
      category: "payment",
      type: "billing-test",
      instance: {},
      schema,
    });

    expect(integration.schema).toEqual(schema);
    expect(
      getIntegrationSchemas({
        billing: integration,
      }),
    ).toEqual({
      billing: schema,
    });

    manager.addPlugins(
      resolveIntegrationPlugins({
        billing: integration,
      }),
    );
    await manager.runHookParallel("init");

    expect(getRegisteredIntegrationSchemas()).toEqual(
      expect.objectContaining({
        billing: schema,
      }),
    );
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

  it("supports same-path routes with singular method definitions", async () => {
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: defineIntegration({
          category: "custom",
          type: "local-demo",
          instance: {},
          routes: [
            {
              path: "/api/local-demo/message",
              method: "get",
              handler() {
                return Response.json({
                  mode: "get",
                });
              },
            },
            {
              path: "/api/local-demo/message",
              method: "POST",
              async handler(request) {
                const body = (await request.json()) as { message?: string };
                return Response.json({
                  mode: "post",
                  message: body.message || null,
                });
              },
            },
          ],
        }),
      }),
    );

    const getReq = createRequest("/api/local-demo/message", "GET");
    const getRes = createResponse();
    const getEnded = await manager.runHookParallel("beforeRequest", getReq as any, getRes as any);

    expect(getEnded).toBe(true);
    expect(getRes.statusCode).toBe(200);
    expect(JSON.parse(getRes.body.toString())).toEqual({
      mode: "get",
    });

    const postReq = createRequest("/api/local-demo/message", "POST");
    const postRes = createResponse();
    const postPromise = manager.runHookParallel("beforeRequest", postReq as any, postRes as any);
    setImmediate(() => {
      postReq.emit("data", Buffer.from(JSON.stringify({ message: "hello" })));
      postReq.emit("end");
    });
    const postEnded = await postPromise;

    expect(postEnded).toBe(true);
    expect(postRes.statusCode).toBe(200);
    expect(JSON.parse(postRes.body.toString())).toEqual({
      mode: "post",
      message: "hello",
    });
  });

  it("validates route input schemas and exposes parsed values in handler context", async () => {
    const routeMiddleware = vi.fn();
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: defineIntegration({
          category: "custom",
          type: "local-demo",
          instance: {},
          routes: [
            integrationRoute.post("/api/local-demo/messages", {
              input: {
                body: z.object({
                  message: z.string().min(2),
                }),
                query: z.object({
                  count: z.coerce.number().int().positive(),
                }),
              },
              middleware: [
                {
                  handler() {
                    routeMiddleware();
                  },
                },
              ],
              async handler(request, context) {
                expectTypeOf(context.input.body).toEqualTypeOf<
                  | {
                      message: string;
                    }
                  | undefined
                >();
                expectTypeOf(context.input.query).toEqualTypeOf<
                  | {
                      count: number;
                    }
                  | undefined
                >();

                const rawBody = (await request.json()) as { message: string };
                return Response.json({
                  message: context.input.body?.message,
                  count: context.input.query?.count,
                  rawMessage: rawBody.message,
                });
              },
            }),
          ],
        }),
      }),
    );

    const invalidReq = createRequest("/api/local-demo/messages?count=bad", "POST");
    const invalidRes = createResponse();
    const invalidPromise = manager.runHookParallel(
      "beforeRequest",
      invalidReq as any,
      invalidRes as any,
    );
    setImmediate(() => {
      invalidReq.emit("data", Buffer.from(JSON.stringify({ message: "x" })));
      invalidReq.emit("end");
    });
    const invalidEnded = await invalidPromise;

    expect(invalidEnded).toBe(true);
    expect(invalidRes.statusCode).toBe(400);
    expect(JSON.parse(invalidRes.body.toString())).toEqual({
      error: "Integration route input validation failed",
      issues: expect.arrayContaining([
        expect.objectContaining({
          source: "body",
          path: ["message"],
        }),
        expect.objectContaining({
          source: "query",
          path: ["count"],
        }),
      ]),
    });
    expect(routeMiddleware).not.toHaveBeenCalled();

    const validReq = createRequest("/api/local-demo/messages?count=2", "POST");
    const validRes = createResponse();
    const validPromise = manager.runHookParallel("beforeRequest", validReq as any, validRes as any);
    setImmediate(() => {
      validReq.emit("data", Buffer.from(JSON.stringify({ message: "hello" })));
      validReq.emit("end");
    });
    const validEnded = await validPromise;

    expect(validEnded).toBe(true);
    expect(validRes.statusCode).toBe(200);
    expect(JSON.parse(validRes.body.toString())).toEqual({
      message: "hello",
      count: 2,
      rawMessage: "hello",
    });
    expect(routeMiddleware).toHaveBeenCalledTimes(1);
  });

  it("supports Better Call-style Zod body and query schemas on integration routes", async () => {
    const beforeHook = vi.fn();
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: defineIntegration({
          category: "custom",
          type: "local-demo",
          instance: {},
          routes: [
            integrationRoute.post("/api/local-demo/direct-zod", {
              body: z.object({
                message: z.string().min(2),
              }),
              query: z.object({
                count: z.coerce.number().int().positive(),
              }),
              before: [
                (_request, context) => {
                  expectTypeOf(context.input.body).toEqualTypeOf<
                    | {
                        message: string;
                      }
                    | undefined
                  >();
                  expectTypeOf(context.input.query).toEqualTypeOf<
                    | {
                        count: number;
                      }
                    | undefined
                  >();
                  beforeHook(context.input.body?.message, context.input.query?.count);
                },
              ],
              handler(_request, context) {
                expectTypeOf(context.input.body).toEqualTypeOf<
                  | {
                      message: string;
                    }
                  | undefined
                >();
                expectTypeOf(context.input.query).toEqualTypeOf<
                  | {
                      count: number;
                    }
                  | undefined
                >();

                return Response.json({
                  message: context.input.body?.message,
                  count: context.input.query?.count,
                });
              },
            }),
          ],
        }),
      }),
    );

    const invalidReq = createRequest("/api/local-demo/direct-zod?count=bad", "POST");
    const invalidRes = createResponse();
    const invalidPromise = manager.runHookParallel(
      "beforeRequest",
      invalidReq as any,
      invalidRes as any,
    );
    setImmediate(() => {
      invalidReq.emit("data", Buffer.from(JSON.stringify({ message: "x" })));
      invalidReq.emit("end");
    });
    const invalidEnded = await invalidPromise;

    expect(invalidEnded).toBe(true);
    expect(invalidRes.statusCode).toBe(400);
    expect(JSON.parse(invalidRes.body.toString())).toEqual({
      error: "Integration route input validation failed",
      issues: expect.arrayContaining([
        expect.objectContaining({
          source: "body",
          path: ["message"],
        }),
        expect.objectContaining({
          source: "query",
          path: ["count"],
        }),
      ]),
    });
    expect(beforeHook).not.toHaveBeenCalled();

    const validReq = createRequest("/api/local-demo/direct-zod?count=3", "POST");
    const validRes = createResponse();
    const validPromise = manager.runHookParallel("beforeRequest", validReq as any, validRes as any);
    setImmediate(() => {
      validReq.emit("data", Buffer.from(JSON.stringify({ message: "hello" })));
      validReq.emit("end");
    });
    const validEnded = await validPromise;

    expect(validEnded).toBe(true);
    expect(validRes.statusCode).toBe(200);
    expect(JSON.parse(validRes.body.toString())).toEqual({
      message: "hello",
      count: 3,
    });
    expect(beforeHook).toHaveBeenCalledWith("hello", 3);
  });

  it("validates route input schemas during server integration dispatch", async () => {
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        serverValidation: defineIntegration({
          category: "custom",
          type: "server-validation",
          instance: {},
          routes: [
            integrationRoute.post("/api/server-validation/echo", {
              input: {
                body: z.object({
                  value: z.string().min(1),
                }),
              },
              handler(_request, context) {
                return Response.json({
                  value: context.input.body?.value,
                });
              },
            }),
          ],
        }),
      }),
    );

    await manager.runHookParallel("init");
    const runtime = getRegisteredIntegrationRuntime("serverValidation");
    expect(runtime).toBeDefined();

    const invalidResponse = await dispatchIntegrationRequest(
      runtime!,
      new Request("http://localhost/api/server-validation/echo", {
        method: "POST",
        body: JSON.stringify({ value: "" }),
      }),
    );

    expect(invalidResponse?.status).toBe(400);
    expect(await invalidResponse?.json()).toEqual({
      error: "Integration route input validation failed",
      issues: [
        expect.objectContaining({
          source: "body",
          path: ["value"],
        }),
      ],
    });

    const validResponse = await dispatchIntegrationRequest(
      runtime!,
      new Request("http://localhost/api/server-validation/echo", {
        method: "POST",
        body: JSON.stringify({ value: "ok" }),
      }),
    );

    expect(validResponse?.status).toBe(200);
    expect(await validResponse?.json()).toEqual({
      value: "ok",
    });
  });

  it("runs route-level middleware in order before the route handler", async () => {
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: defineIntegration({
          category: "custom",
          type: "local-demo",
          instance: {},
          routes: [
            {
              path: "/api/local-demo/middleware",
              method: "GET",
              middleware: [
                {
                  handler(_request, context) {
                    context.requestContext.set("route-middleware-order", ["first"]);
                  },
                },
                {
                  handler(_request, context) {
                    const order =
                      context.requestContext.get<string[]>("route-middleware-order") || [];
                    context.requestContext.set("route-middleware-order", [...order, "second"]);
                  },
                },
              ],
              handler(_request, context) {
                return Response.json({
                  middleware: context.requestContext.get("route-middleware-order"),
                });
              },
            },
          ],
        }),
      }),
    );

    const req = createRequest("/api/local-demo/middleware");
    const res = createResponse();
    const ended = await manager.runHookParallel("beforeRequest", req as any, res as any);

    expect(ended).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body.toString())).toEqual({
      middleware: ["first", "second"],
    });
  });

  it("runs route before and after hooks around the route handler", async () => {
    const manager = createManager();
    const handlerSpy = vi.fn();
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: defineIntegration({
          category: "custom",
          type: "local-demo",
          instance: {},
          routes: [
            integrationRoute.get<"/api/local-demo/hooks", { order: string[]; after: boolean }>(
              "/api/local-demo/hooks",
              {
                before: [
                  (_request, context) => {
                    expect(context.response).toBeUndefined();
                    context.requestContext.set("hook-order", ["before"]);
                  },
                ],
                after: [
                  async (_request, context) => {
                    expect(context.response?.status).toBe(200);
                    const body = (await context.response?.clone().json()) as { order: string[] };
                    return Response.json(
                      {
                        order: [...body.order, "after"],
                        after: true,
                      },
                      {
                        headers: {
                          "x-integration-after": "yes",
                        },
                      },
                    );
                  },
                ],
                handler(_request, context) {
                  handlerSpy();
                  const order = context.requestContext.get<string[]>("hook-order") || [];
                  return Response.json({
                    order: [...order, "handler"],
                    after: false,
                  });
                },
              },
            ),
          ],
        }),
      }),
    );

    const req = createRequest("/api/local-demo/hooks");
    const res = createResponse();
    const ended = await manager.runHookParallel("beforeRequest", req as any, res as any);

    expect(ended).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.getHeader("x-integration-after")).toBe("yes");
    expect(JSON.parse(res.body.toString())).toEqual({
      order: ["before", "handler", "after"],
      after: true,
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("lets route before hooks short-circuit and route after hooks inspect that response", async () => {
    const manager = createManager();
    const handlerSpy = vi.fn();
    const integration = defineIntegration({
      category: "custom",
      type: "local-demo",
      instance: {},
      routes: [
        integrationRoute.get("/api/local-demo/blocked", {
          before: [
            (_request, context) => {
              context.requestContext.set("blocked", true);
              return Response.json(
                {
                  blocked: context.requestContext.get("blocked"),
                },
                {
                  status: 403,
                },
              );
            },
          ],
          after: [
            (_request, context) => {
              expect(context.response?.status).toBe(403);
              context.response?.headers.set("x-integration-after", "blocked");
            },
          ],
          handler() {
            handlerSpy();
            return Response.json({ ok: true });
          },
        }),
      ],
    });

    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: integration,
      }),
    );
    await manager.runHookParallel("init");
    const runtime = getRegisteredIntegrationRuntime("localDemo");
    expect(runtime).toBeDefined();

    const response = await dispatchIntegrationRequest(
      runtime!,
      new Request("http://localhost/api/local-demo/blocked"),
    );

    expect(response?.status).toBe(403);
    expect(response?.headers.get("x-integration-after")).toBe("blocked");
    expect(await response?.json()).toEqual({
      blocked: true,
    });
    expect(handlerSpy).not.toHaveBeenCalled();
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

  it("can match registered integration routes without dispatching them", async () => {
    const manager = createManager();
    const integration = defineIntegration({
      category: "payment",
      type: "stripe",
      instance: {},
      routes: [
        {
          path: "/billing/checkout",
          method: "POST",
          handler() {
            return Response.json({ ok: true });
          },
        },
      ],
    });

    manager.addPlugins(
      resolveIntegrationPlugins({
        billing: integration,
      }),
    );
    await manager.runHookParallel("init");

    expect(
      matchRegisteredIntegrationRoute({
        pathname: "/billing/checkout",
        method: "POST",
      }),
    ).toEqual(
      expect.objectContaining({
        key: "billing",
        integration: expect.objectContaining({
          type: "stripe",
        }),
        route: {
          path: "/billing/checkout",
          methods: ["POST"],
        },
        params: {},
      }),
    );

    expect(
      matchRegisteredIntegrationRoute({
        pathname: "/billing/checkout",
        method: "GET",
      }),
    ).toBeNull();
  });
});
