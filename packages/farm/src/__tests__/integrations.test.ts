import { EventEmitter } from "events";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { definePlugin, PluginManager, type FarmPluginIntegrationContext } from "../plugin";
import {
  defineIntegration,
  dispatchIntegrationRequest,
  getFarmIntegrationPluginOwner,
  getFarmIntegrationPluginServerRuntime,
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

  it("marks platform-owned integration lifecycle plugins as non-server runtime", () => {
    const platformOwned = defineIntegration({
      category: "agent",
      type: "platform-owned",
      instance: {},
      serverRuntime: false,
    });
    const serverOwned = defineIntegration({
      category: "agent",
      type: "server-owned",
      instance: {},
    });

    expect(
      getFarmIntegrationPluginServerRuntime(resolveIntegrationPlugins({ agent: platformOwned })[0]),
    ).toBe(false);
    expect(
      getFarmIntegrationPluginServerRuntime(resolveIntegrationPlugins({ agent: serverOwned })[0]),
    ).toBe(true);
  });

  it("binds integration context to normal contributed plugins", async () => {
    const state = {
      label: "billing",
    };
    let setupIntegration: Readonly<FarmPluginIntegrationContext> | undefined;
    let requestIntegration: Readonly<FarmPluginIntegrationContext> | undefined;
    let globalIntegration: Readonly<FarmPluginIntegrationContext> | undefined;

    function billingPlugin() {
      return definePlugin({
        name: "billing:session",
        setup({ integration }) {
          setupIntegration = integration;
        },
        runtime: {
          context({ integration }) {
            requestIntegration = integration;
            return {
              billingLabel: integration?.instance.label,
            };
          },
        },
      });
    }

    const integration = defineIntegration({
      category: "payment",
      type: "contextual-plugins",
      instance: state,
      plugins: [billingPlugin()],
    });

    const plugins = resolveIntegrationPlugins({ checkout: integration });

    expect(plugins.map((plugin) => plugin.name)).toEqual([
      "farm:integration:payment:contextual-plugins",
      "billing:session",
    ]);
    expect(getFarmIntegrationPluginOwner(plugins[0])).toEqual({
      key: "checkout",
      category: "payment",
      type: "contextual-plugins",
      source: "lifecycle",
      serverRuntime: true,
    });
    expect(getFarmIntegrationPluginOwner(plugins[1])).toEqual({
      key: "checkout",
      category: "payment",
      type: "contextual-plugins",
      source: "contribution",
      serverRuntime: true,
    });

    const globalPlugin = definePlugin({
      name: "global:request",
      runtime: {
        context({ integration }) {
          globalIntegration = integration;
          return {};
        },
      },
    });
    const manager = createManager();
    manager.addPlugins([...plugins, globalPlugin]);

    const response = await manager.runRuntimeRequest(
      new Request("http://localhost/checkout"),
      () => new Response("ok"),
    );

    expect(await response.text()).toBe("ok");
    expect(setupIntegration).toMatchObject({
      key: "checkout",
      category: "payment",
      type: "contextual-plugins",
      serverRuntime: true,
    });
    expect(setupIntegration?.instance).toBe(state);
    expect(requestIntegration).toBe(setupIntegration);
    expect(globalIntegration).toBeUndefined();
  });

  it("keeps static plugin arrays compatible and propagates server ownership", () => {
    const contributedPlugin = {
      name: "platform:contribution",
    };
    const integration = defineIntegration({
      category: "agent",
      type: "platform-plugins",
      instance: {},
      serverRuntime: false,
      plugins: [contributedPlugin],
    });

    const plugins = resolveIntegrationPlugins({ agent: integration });

    expect(plugins[1]).not.toBe(contributedPlugin);
    expect(plugins[1].name).toBe(contributedPlugin.name);
    expect(getFarmIntegrationPluginServerRuntime(plugins[1])).toBe(false);
    expect(getFarmIntegrationPluginOwner(plugins[1])?.source).toBe("contribution");
  });

  it("rejects duplicate plugin names from one integration", () => {
    const integration = defineIntegration({
      category: "custom",
      type: "duplicate-plugins",
      instance: {},
      plugins: [{ name: "duplicate" }, { name: "duplicate" }],
    });

    expect(() => resolveIntegrationPlugins({ duplicate: integration })).toThrow(
      'Integration "duplicate" contributes duplicate plugin name "duplicate"',
    );
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

  it("runs flat integration config and lifecycle hooks", async () => {
    const manager = createManager();
    const calls: string[] = [];
    const originalSecretKey = process.env.FARM_TEST_STRIPE_SECRET_KEY;
    process.env.FARM_TEST_STRIPE_SECRET_KEY = "sk_test_lifecycle";

    try {
      const integration = defineIntegration({
        category: "payment",
        type: "stripe-lifecycle",
        instance: {},
        config: {
          schema: z.object({
            secretKey: z.string(),
            mode: z.enum(["test", "live"]).default("test"),
          }),
          env: {
            secretKey: "FARM_TEST_STRIPE_SECRET_KEY",
          },
        },
        validate(ctx) {
          expect(ctx.key).toBe("stripe");
          expect(ctx.integrationConfig.secretKey).toBe("sk_test_lifecycle");
          expect(ctx.integrationConfig.mode).toBe("test");
          expectTypeOf(ctx.integrationConfig.secretKey).toEqualTypeOf<string>();
          ctx.cleanup(() => {
            calls.push("cleanup");
          });
          calls.push("validate");
        },
        async setup(ctx) {
          expect(ctx.args.db).toBeDefined();
          expect(ctx.integrationConfig.secretKey).toBe("sk_test_lifecycle");
          calls.push("setup");
        },
        ready(ctx) {
          expect(ctx.integrationConfig.mode).toBe("test");
          calls.push("ready");
        },
        dispose(ctx) {
          expect(ctx.reason).toBe("test");
          calls.push("dispose");
        },
      });

      manager.addPlugins(
        resolveIntegrationPlugins({
          stripe: integration,
        }),
      );

      await manager.runHookParallel("init");
      await manager.runHookParallel("ready");
      await manager.runHookParallel("shutdown", { reason: "test" });

      expect(calls).toEqual(["validate", "setup", "ready", "dispose", "cleanup"]);
    } finally {
      if (originalSecretKey === undefined) {
        delete process.env.FARM_TEST_STRIPE_SECRET_KEY;
      } else {
        process.env.FARM_TEST_STRIPE_SECRET_KEY = originalSecretKey;
      }
    }
  });

  it("validates integration config during init without lifecycle hooks", async () => {
    const manager = createManager();
    const integration = defineIntegration({
      category: "payment",
      type: "missing-config",
      instance: {},
      config: {
        schema: z.object({
          secretKey: z.string(),
        }),
        env: {
          secretKey: "FARM_TEST_MISSING_SECRET_KEY",
        },
      },
    });

    manager.addPlugins(
      resolveIntegrationPlugins({
        missingConfig: integration,
      }),
    );

    await expect(manager.runHookParallel("init")).rejects.toThrow(
      'Integration "missing-config" config validation failed',
    );
  });

  it("registers route integrations as pre-plugins and exposes shared handler context", async () => {
    const log = vi.fn();
    const manager = createManager();
    manager.addPlugin({
      name: "seed-request-context",
      enforce: "pre",
      beforeRequest(_req, _res, context) {
        context.req.set("seed", "shared-value");
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
                expect(context.req).toBe(context.requestContext);
                expect(context.req.get("seed")).toBe("shared-value");

                context.req.set("handled", "yes");

                return Response.json(
                  {
                    provider: context.params.provider,
                    auth: context.params.auth,
                    handled: context.req.get("handled"),
                    seeded: context.req.get("seed"),
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

  it("normalizes Standard Schema property-key issue paths for JSON responses", async () => {
    const manager = createManager();
    const secretKey = Symbol("secret");
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: defineIntegration({
          category: "custom",
          type: "property-key-paths",
          instance: {},
          routes: [
            integrationRoute.post("/api/local-demo/property-key-paths", {
              body: {
                safeParse() {
                  return {
                    success: false as const,
                    error: {
                      issues: [
                        {
                          path: [secretKey, { key: "value" }],
                          message: "Invalid property-key path",
                        },
                      ],
                    },
                  };
                },
              },
              handler() {
                return Response.json({ ok: true });
              },
            }),
          ],
        }),
      }),
    );

    const req = createRequest("/api/local-demo/property-key-paths", "POST");
    const res = createResponse();
    const result = manager.runHookParallel("beforeRequest", req as any, res as any);
    setImmediate(() => {
      req.emit("data", Buffer.from(JSON.stringify({ value: "invalid" })));
      req.emit("end");
    });

    await expect(result).resolves.toBe(true);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body.toString())).toEqual({
      error: "Integration route input validation failed",
      issues: [
        {
          source: "body",
          path: ["secret", "value"],
          message: "Invalid property-key path",
        },
      ],
    });
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

  it("rejects integration request bodies above the server limit", async () => {
    const handler = vi.fn(() => Response.json({ ok: true }));
    const manager = new PluginManager({
      config: { server: { bodySizeLimit: 8 } },
      isDev: true,
      isProd: false,
    });
    manager.addPlugins(
      resolveIntegrationPlugins({
        limited: defineIntegration({
          category: "custom",
          type: "limited",
          instance: {},
          routes: [
            integrationRoute.post("/api/limited", {
              handler,
            }),
          ],
        }),
      }),
    );
    await manager.runHookParallel("init");

    const runtime = getRegisteredIntegrationRuntime("limited");
    const response = await dispatchIntegrationRequest(
      runtime!,
      new Request("http://localhost/api/limited", {
        method: "POST",
        body: "request-too-large",
      }),
    );

    expect(response?.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
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
                    context.req.set("route-middleware-order", ["first"]);
                  },
                },
                {
                  handler(_request, context) {
                    const order = context.req.get<string[]>("route-middleware-order") || [];
                    context.req.set("route-middleware-order", [...order, "second"]);
                  },
                },
              ],
              handler(_request, context) {
                return Response.json({
                  middleware: context.req.get("route-middleware-order"),
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

  it("exposes serialized integration data on HTTP route contexts", async () => {
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: defineIntegration({
          category: "custom",
          type: "local-demo",
          instance: {},
          routes: [
            integrationRoute.get<"/api/local-demo/data", { data: Record<string, unknown> }>(
              "/api/local-demo/data",
              {
                handler(_request, context) {
                  return Response.json({
                    data: context.data,
                  });
                },
              },
            ),
          ],
        }),
      }),
    );

    const req = createRequest("/api/local-demo/data");
    req.headers["x-farm-integration-data"] = JSON.stringify({
      tenantId: "tenant_browser",
      locale: "en",
    });
    const res = createResponse();
    const ended = await manager.runHookParallel("beforeRequest", req as any, res as any);

    expect(ended).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body.toString())).toEqual({
      data: {
        tenantId: "tenant_browser",
        locale: "en",
      },
    });
  });

  it("sanitizes untrusted integration data headers", async () => {
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: defineIntegration({
          category: "custom",
          type: "local-demo",
          instance: {},
          routes: [
            integrationRoute.get<"/api/local-demo/data", { data: Record<string, unknown> }>(
              "/api/local-demo/data",
              {
                handler(_request, context) {
                  return Response.json({
                    data: context.data,
                    polluted: ({} as { polluted?: boolean }).polluted ?? null,
                    hasProto: Object.prototype.hasOwnProperty.call(context.data, "__proto__"),
                    hasConstructor: Object.prototype.hasOwnProperty.call(
                      context.data,
                      "constructor",
                    ),
                    hasPrototype: Object.prototype.hasOwnProperty.call(context.data, "prototype"),
                  });
                },
              },
            ),
          ],
        }),
      }),
    );

    const req = createRequest("/api/local-demo/data");
    req.headers["x-farm-integration-data"] =
      '{"tenantId":"tenant_browser","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"nested":{"safe":true,"constructor":{"prototype":{"polluted":true}}}}';
    const res = createResponse();
    const ended = await manager.runHookParallel("beforeRequest", req as any, res as any);

    expect(ended).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body.toString())).toEqual({
      data: {
        tenantId: "tenant_browser",
        nested: {
          safe: true,
        },
      },
      polluted: null,
      hasProto: false,
      hasConstructor: false,
      hasPrototype: false,
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("ignores oversized integration data headers", async () => {
    const manager = createManager();
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: defineIntegration({
          category: "custom",
          type: "local-demo",
          instance: {},
          routes: [
            integrationRoute.get<"/api/local-demo/data", { data: Record<string, unknown> }>(
              "/api/local-demo/data",
              {
                handler(_request, context) {
                  return Response.json({
                    data: context.data,
                  });
                },
              },
            ),
          ],
        }),
      }),
    );

    const req = createRequest("/api/local-demo/data");
    req.headers["x-farm-integration-data"] = JSON.stringify({
      blob: "x".repeat(17 * 1024),
    });
    const res = createResponse();
    const ended = await manager.runHookParallel("beforeRequest", req as any, res as any);

    expect(ended).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body.toString())).toEqual({
      data: {},
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
                    context.req.set("hook-order", ["before"]);
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
                  const order = context.req.get<string[]>("hook-order") || [];
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
              context.req.set("blocked", true);
              return Response.json(
                {
                  blocked: context.req.get("blocked"),
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
