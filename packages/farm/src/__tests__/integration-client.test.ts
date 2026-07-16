import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { defineIntegration, integrationRoute, resolveIntegrationPlugins } from "../integrations";
import {
  createIntegrationApi,
  createIntegrationClient,
  createIntegrationClients,
  createIntegrations,
  createIntegrationServerClient,
  endpoint,
  integrationClients,
  integrationsClient,
  integrationsServer,
  IntegrationClientError,
} from "../client";
import { PluginManager } from "../plugin";
import { _runWithCurrentRequest } from "../server/request";

describe("integration client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubBrowser(origin = "http://localhost:3000") {
    vi.stubGlobal("window", {
      location: {
        origin,
      },
    });
  }

  function stubServer() {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
  }

  it("creates typed callers from an integration object's api definition", async () => {
    stubBrowser();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ redirectTo: "http://localhost:3000/dashboard" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const auth = defineIntegration({
      category: "auth",
      type: "supabase",
      instance: {},
      api: {
        login: endpoint.post<
          { email: string; password: string; returnTo?: string },
          { redirectTo: string }
        >("/auth/login"),
      },
    });

    const api = createIntegrationClient({ supabase: auth });
    const result = await api.supabase.login({
      body: {
        email: "user@example.com",
        password: "secret",
        returnTo: "/dashboard",
      },
    });

    expect(result.error).toBeNull();
    expect(result.data?.redirectTo).toBe("http://localhost:3000/dashboard");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.any(Headers),
        body: JSON.stringify({
          email: "user@example.com",
          password: "secret",
          returnTo: "/dashboard",
        }),
      }),
    );

    const headers = fetchSpy.mock.calls[0]?.[1]
      ? new Headers(fetchSpy.mock.calls[0][1]!.headers as HeadersInit)
      : new Headers();
    expect(headers.get("x-farm-integration-client")).toBe("1");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("serializes query parameters and returns typed errors for non-ok responses", async () => {
    stubBrowser();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const api = createIntegrationClient({
      supabase: {
        session: endpoint.get<{ refresh?: string }, { authenticated: boolean }>("/auth/session", {
          responseFormat: "json",
        }),
      },
    });

    const result = await api.supabase.session({
      query: {
        refresh: "1",
      },
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({
      name: "IntegrationClientError",
      status: 401,
      message: "Unauthorized",
    } satisfies Partial<IntegrationClientError>);
  });

  it("supports nesting namespaces under an integrations key", async () => {
    stubBrowser();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const api = createIntegrationClient({
      integrations: {
        supabase: {
          session: endpoint.get<{ authenticated: boolean }>("/auth/session", {
            responseFormat: "json",
          }),
        },
      },
    });

    const result = await api.supabase.session();

    expect(result.error).toBeNull();
    expect(result.data?.authenticated).toBe(false);
    expect(api.integrations.supabase).toBe(api.supabase);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/auth/session",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("creates api and apiClient aliases from the same integration definitions", async () => {
    stubBrowser();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const { apiClient } = createIntegrationClients({
      auth: {
        session: endpoint.get<{ authenticated: boolean }>("/auth/session", {
          responseFormat: "json",
        }),
      },
    });

    const result = await apiClient.auth.session();

    expect(result.error).toBeNull();
    expect(result.data?.authenticated).toBe(false);
  });

  it("supports integrationClients as an alias for createIntegrationClients", async () => {
    stubBrowser();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const { apiClient } = integrationClients({
      auth: {
        session: endpoint.get<{ authenticated: boolean }>("/auth/session", {
          responseFormat: "json",
        }),
      },
    });

    const result = await apiClient.auth.session();

    expect(result.error).toBeNull();
    expect(result.data?.authenticated).toBe(false);
  });

  it("serializes createIntegrations data for browser integration calls", async () => {
    stubBrowser();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    (window as any).__FARM_INTEGRATION_API_MANIFEST__ = {
      localDemo: {
        data: endpoint.route(
          "/api/local-demo/data",
          endpoint.get<{ ok: boolean }>({
            responseFormat: "json",
          }),
        ),
      },
    };

    const globalData = JSON.parse(
      '{"tenantId":"tenant_global","plan":"starter","__proto__":{"polluted":true},"nested":{"safe":true,"constructor":{"prototype":{"polluted":true}}}}',
    ) as Record<string, unknown>;
    const callData = JSON.parse(
      '{"tenantId":"tenant_call","locale":"en","prototype":{"polluted":true}}',
    ) as Record<string, unknown>;

    const { apiClient } = createIntegrations<{
      localDemo: {
        data: {
          get: ReturnType<typeof endpoint.get<{ ok: boolean }>>;
        };
      };
    }>({ data: globalData });

    const result = await apiClient.localDemo.data.get(undefined, {
      data: callData,
    });

    expect(result.error).toBeNull();
    const headers = fetchSpy.mock.calls[0]?.[1]
      ? new Headers(fetchSpy.mock.calls[0][1]!.headers as HeadersInit)
      : new Headers();
    expect(JSON.parse(headers.get("x-farm-integration-data") || "{}")).toEqual({
      tenantId: "tenant_call",
      plan: "starter",
      locale: "en",
      nested: {
        safe: true,
      },
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("rejects oversized integration data before browser fetches", async () => {
    stubBrowser();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    (window as any).__FARM_INTEGRATION_API_MANIFEST__ = {
      localDemo: {
        data: endpoint.route(
          "/api/local-demo/data",
          endpoint.get<{ ok: boolean }>({
            responseFormat: "json",
          }),
        ),
      },
    };

    const { apiClient } = createIntegrations<{
      localDemo: {
        data: {
          get: ReturnType<typeof endpoint.get<{ ok: boolean }>>;
        };
      };
    }>({
      data: {
        blob: "x".repeat(17 * 1024),
      },
    });

    const result = await apiClient.localDemo.data.get();

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("must be smaller");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates api and apiClient aliases from registered integrations when no sources are passed", async () => {
    stubBrowser();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    (window as any).__FARM_INTEGRATION_API_MANIFEST__ = {
      localDemo: {
        message: endpoint.route(
          "/api/local-demo/message",
          endpoint.get<{ ok: boolean }>({
            responseFormat: "json",
          }),
        ),
      },
    };

    const { apiClient } = createIntegrationClients<{
      localDemo: {
        message: {
          get: ReturnType<typeof endpoint.get<{ ok: boolean }>>;
        };
      };
    }>();

    const result = await apiClient.localDemo.message.get();

    expect(result.error).toBeNull();
    expect(result.data?.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/local-demo/message",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("ignores integrations that do not expose an api when creating clients", async () => {
    stubBrowser();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const clerk = defineIntegration({
      category: "auth",
      type: "clerk",
      instance: {},
      middleware: [],
      providers: [],
    });

    const localDemo = defineIntegration({
      category: "custom",
      type: "local-demo",
      instance: {},
      api: {
        status: endpoint.get<{ ok: boolean }>("/api/local-demo/status", {
          responseFormat: "json",
        }),
      },
    });

    const { apiClient } = createIntegrationClients({
      auth: clerk,
      localDemo,
    });

    if (false) {
      // @ts-expect-error integrations without api are omitted from client callers
      apiClient.auth;
    }

    const result = await apiClient.localDemo.status();

    expect(result.error).toBeNull();
    expect(result.data?.ok).toBe(true);
    expect((apiClient as any).auth).toBeUndefined();
  });

  it("supports grouped same-path methods through api.route", async () => {
    stubBrowser();

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, mode: "get" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, mode: "post" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );

    const api = createIntegrationClient({
      integrations: {
        localDemo: {
          message: endpoint.route(
            "/api/local-demo/message",
            endpoint.get<{ ok: boolean; mode: string }>({
              responseFormat: "json",
            }),
            endpoint.post<{ message: string }, { ok: boolean; mode: string }>({
              responseFormat: "json",
            }),
          ),
        },
      },
    });

    const getResult = await api.localDemo.message.get();
    const postResult = await api.localDemo.message.post({
      body: {
        message: "hello",
      },
    });

    expect(getResult.error).toBeNull();
    expect(postResult.error).toBeNull();
    expect(getResult.data?.mode).toBe("get");
    expect(postResult.data?.mode).toBe("post");
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/api/local-demo/message",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/local-demo/message",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          message: "hello",
        }),
      }),
    );
  });

  it("allows calling single-method namespaces directly while preserving the method accessor", async () => {
    stubBrowser();

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, source: "direct" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, source: "method" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );

    const api = createIntegrationClient({
      integrations: {
        localDemo: {
          product: endpoint.route(
            "/billing/product",
            endpoint.get<{ ok: boolean; source: string }>({
              responseFormat: "json",
            }),
          ),
        },
      },
    });

    const directResult = await api.localDemo.product();
    const methodResult = await api.localDemo.product.get();

    expect(directResult.error).toBeNull();
    expect(methodResult.error).toBeNull();
    expect(directResult.data?.source).toBe("direct");
    expect(methodResult.data?.source).toBe("method");
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/billing/product",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/billing/product",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("derives grouped client methods from typed integration routes", async () => {
    stubBrowser();

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, mode: "get" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, mode: "post" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );

    const routes = [
      integrationRoute.get("/api/local-demo/message", {
        responseFormat: "json",
        handler() {
          return Response.json({ ok: true, mode: "get" });
        },
      }),
      integrationRoute.post<
        "/api/local-demo/message",
        { message: string },
        { ok: boolean; mode: string }
      >("/api/local-demo/message", {
        responseFormat: "json",
        handler() {
          return Response.json({ ok: true, mode: "post" });
        },
      }),
    ] as const;

    const api = createIntegrationClient({
      integrations: {
        localDemo: endpoint.fromRoutes(routes),
      },
    });

    const getResult = await api.localDemo.message.get();
    const postResult = await api.localDemo.message.post({
      body: {
        message: "hello",
      },
    });

    expect(getResult.error).toBeNull();
    expect(postResult.error).toBeNull();
    expect(getResult.data?.mode).toBe("get");
    expect(postResult.data?.mode).toBe("post");
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/api/local-demo/message",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/local-demo/message",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("infers nested namespaces from mounted base paths", async () => {
    stubBrowser();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, source: "mounted" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const routes = [
      integrationRoute.get("/api/payment/billing/status", {
        responseFormat: "json",
        handler() {
          return Response.json({ ok: true, source: "mounted" });
        },
      }),
    ] as const;

    const api = createIntegrationClient({
      integrations: {
        payment: endpoint.fromRoutes(routes),
      },
    });

    const result = await api.payment.billing.status();

    expect(result.error).toBeNull();
    expect(result.data?.source).toBe("mounted");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/payment/billing/status",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("keeps default /api calls and mounted base-path namespaces callable", () => {
    const directApi = createIntegrationClient({
      billing: {
        products: endpoint.get<{ ok: true }>("/billing/products", {
          responseFormat: "json",
        }),
      },
    });

    const mountedRoutes = [
      integrationRoute.get("/api/payment/billing/status", {
        responseFormat: "json",
        handler() {
          return Response.json({ ok: true });
        },
      }),
    ] as const;

    const mountedApi = createIntegrationClient({
      integrations: {
        payment: endpoint.fromRoutes(mountedRoutes),
      },
    });

    expectTypeOf(directApi.billing.products).toBeCallableWith();
    expectTypeOf(mountedApi.payment.billing.status).toBeCallableWith();
  });

  it("infers patch and delete method namespaces through api.route", async () => {
    stubBrowser();

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, mode: "patch" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, mode: "delete" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );

    const api = createIntegrationClient({
      integrations: {
        localDemo: {
          message: endpoint.route(
            "/api/local-demo/message",
            endpoint.patch<{ message: string }, { ok: boolean; mode: string }>({
              responseFormat: "json",
            }),
            endpoint.delete<{ hard?: boolean }, { ok: boolean; mode: string }>({
              responseFormat: "json",
            }),
          ),
        },
      },
    });

    const patchResult = await api.localDemo.message.patch({
      body: {
        message: "update",
      },
    });
    const deleteResult = await api.localDemo.message.delete({
      body: {
        hard: true,
      },
    });

    expect(patchResult.error).toBeNull();
    expect(deleteResult.error).toBeNull();
    expect(patchResult.data?.mode).toBe("patch");
    expect(deleteResult.data?.mode).toBe("delete");
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/api/local-demo/message",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          message: "update",
        }),
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/local-demo/message",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({
          hard: true,
        }),
      }),
    );
  });

  it("supports request-aware server calls with forwarded headers", async () => {
    stubServer();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    );

    const integrations = {
      integrations: {
        analytics: {
          report: endpoint.get<{ authenticated: boolean }>("/analytics/report", {
            responseFormat: "json",
            isServer: true,
          }),
        },
      },
    };

    const request = new Request("https://farmjs.dev/dashboard", {
      headers: {
        cookie: "sb-access-token=123",
        authorization: "Bearer token",
      },
    });

    const directServerApi = createIntegrationServerClient(integrations, {
      request,
    });
    const clientApi = createIntegrationClient(integrations);
    const flaggedServerApi = createIntegrationClient(integrations, {
      isServer: true,
      request,
    });
    const wrappedApi = createIntegrationApi(integrations);

    if (false) {
      // @ts-expect-error server-registered methods are omitted from client callers
      clientApi.analytics.report();
    }

    await expect((clientApi as any).analytics.report()).rejects.toThrow(
      "registered with isServer: true",
    );

    const directResult = await directServerApi.analytics.report();
    const flaggedResult = await flaggedServerApi.analytics.report();
    const wrappedResult = await wrappedApi
      .server({
        request,
      })
      .analytics.report();

    expect(directResult.error).toBeNull();
    expect(flaggedResult.error).toBeNull();
    expect(wrappedResult.error).toBeNull();
    expect(directResult.data?.authenticated).toBe(true);
    expect(flaggedResult.data?.authenticated).toBe(true);
    expect(wrappedResult.data?.authenticated).toBe(true);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://farmjs.dev/analytics/report",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      }),
    );

    const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get("cookie")).toBe("sb-access-token=123");
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("x-farm-integration-client")).toBe("1");
    expect(directServerApi.integrations.analytics).toBe(directServerApi.analytics);
  });

  it("creates a reusable server client without passing options", async () => {
    stubServer();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const apiServer = createIntegrationServerClient({
      integrations: {
        localDemo: {
          message: endpoint.route(
            "/api/local-demo/message",
            endpoint.get<{ ok: boolean }>({
              responseFormat: "json",
              isServer: true,
            }),
          ),
        },
      },
    });

    await _runWithCurrentRequest(new Request("https://farmjs.dev/server-demo"), async () => {
      const result = await apiServer.localDemo.message.get();

      expect(result.error).toBeNull();
      expect(result.data?.ok).toBe(true);
      expect(apiServer.integrations.localDemo).toBe(apiServer.localDemo);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://farmjs.dev/api/local-demo/message",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("allows direct server calls for single-method namespaces", async () => {
    stubServer();

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, source: "direct" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, source: "method" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );

    const apiServer = createIntegrationServerClient({
      integrations: {
        localDemo: {
          product: endpoint.route(
            "/billing/product",
            endpoint.get<{ ok: boolean; source: string }>({
              responseFormat: "json",
              isServer: true,
            }),
          ),
        },
      },
    });

    await _runWithCurrentRequest(new Request("https://farmjs.dev/server-demo"), async () => {
      const directResult = await apiServer.localDemo.product();
      const methodResult = await apiServer.localDemo.product.get();

      expect(directResult.error).toBeNull();
      expect(methodResult.error).toBeNull();
      expect(directResult.data?.source).toBe("direct");
      expect(methodResult.data?.source).toBe("method");
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://farmjs.dev/billing/product",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://farmjs.dev/billing/product",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("supports integrationsClient and integrationsServer without manual source maps", async () => {
    stubServer();

    const integration = defineIntegration({
      category: "custom",
      type: "local-demo",
      instance: {},
      routes: [
        integrationRoute.get<
          "/api/local-demo/message",
          { ok: boolean; direct: boolean },
          never,
          true
        >("/api/local-demo/message", {
          responseFormat: "json",
          isServer: true,
          handler() {
            return Response.json({
              ok: true,
              direct: true,
            });
          },
        }),
      ],
    });

    const manager = new PluginManager({
      config: {
        integrations: {
          localDemo: integration,
        },
      } as any,
      isDev: true,
      isProd: false,
    });
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: integration,
      }),
    );
    await manager.runHookParallel("init");

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const api = integrationsServer<{
      localDemo: typeof integration;
    }>();

    await _runWithCurrentRequest(new Request("https://farmjs.dev/server-demo"), async () => {
      const result = await api.localDemo.message.get();

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        ok: true,
        direct: true,
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();

    stubBrowser();
    (window as any).__FARM_INTEGRATION_API_MANIFEST__ = {
      localDemo: {
        message: endpoint.route(
          "/api/local-demo/message",
          endpoint.get<{ ok: boolean }>({
            responseFormat: "json",
          }),
        ),
      },
    };

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const apiClient = integrationsClient<{
      localDemo: {
        message: {
          get: ReturnType<typeof endpoint.get<{ ok: boolean }>>;
        };
      };
    }>();
    const clientResult = await apiClient.localDemo.message.get();

    expect(clientResult.error).toBeNull();
    expect(clientResult.data?.ok).toBe(true);
  });

  it("passes createIntegrations data to registered server handlers", async () => {
    stubServer();

    const integration = defineIntegration({
      category: "custom",
      type: "local-demo",
      instance: {},
      routes: [
        integrationRoute.get<
          "/api/local-demo/data",
          { data: Record<string, unknown> },
          never,
          true
        >("/api/local-demo/data", {
          responseFormat: "json",
          isServer: true,
          handler(_request, context) {
            return Response.json({
              data: context.data,
            });
          },
        }),
      ],
    });

    const manager = new PluginManager({
      config: {
        integrations: {
          localDemo: integration,
        },
      } as any,
      isDev: true,
      isProd: false,
    });
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: integration,
      }),
    );
    await manager.runHookParallel("init");

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { api } = createIntegrations<{
      localDemo: typeof integration;
    }>({
      data: {
        tenantId: "tenant_global",
        plan: "starter",
      },
    });

    await _runWithCurrentRequest(new Request("https://farmjs.dev/server-demo"), async () => {
      const result = await api.localDemo.data.get(undefined, {
        data: {
          tenantId: "tenant_call",
          locale: "en",
        },
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        data: {
          tenantId: "tenant_call",
          plan: "starter",
          locale: "en",
        },
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("picks up newly added client manifest operations without rebuilding the root alias", async () => {
    stubBrowser();

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, batched: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      );

    (window as any).__FARM_INTEGRATION_API_MANIFEST__ = {
      localDemo: {
        message: {
          get: endpoint.route(
            "/api/local-demo/message",
            endpoint.get<{ ok: boolean }>({
              responseFormat: "json",
            }),
          ),
        },
      },
    };

    const apiClient = integrationsClient<{
      localDemo: {
        message: {
          get: ReturnType<typeof endpoint.route>;
          batchTrigger: ReturnType<typeof endpoint.route>;
        };
      };
    }>();

    const initialResult = await apiClient.localDemo.message.get();

    expect(initialResult.error).toBeNull();
    expect(initialResult.data?.ok).toBe(true);

    (window as any).__FARM_INTEGRATION_API_MANIFEST__ = {
      localDemo: {
        message: {
          get: endpoint.route(
            "/api/local-demo/message",
            endpoint.get<{ ok: boolean }>({
              responseFormat: "json",
            }),
          ),
          batchTrigger: endpoint.route(
            "/api/local-demo/message/batch-trigger",
            endpoint.post<{ items: { id: string }[] }, { ok: boolean; batched: boolean }>({
              responseFormat: "json",
            }),
          ),
        },
      },
    };

    const batchResult = await apiClient.localDemo.message.batchTrigger({
      body: {
        items: [{ id: "msg_1" }],
      },
    });

    expect(batchResult.error).toBeNull();
    expect(batchResult.data).toEqual({
      ok: true,
      batched: true,
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/local-demo/message/batch-trigger",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("calls registered integration handlers directly on the server", async () => {
    stubServer();

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logSpy = vi.fn();
    const handlerSpy = vi.fn();
    const integration = defineIntegration({
      category: "custom",
      type: "local-demo",
      instance: {},
      log: logSpy,
      routes: [
        integrationRoute.get<
          "/api/local-demo/message",
          { ok: boolean; direct: boolean; middlewareOrder: string[] },
          never,
          true
        >("/api/local-demo/message", {
          responseFormat: "json",
          isServer: true,
          middleware: [
            {
              handler(_request, context) {
                context.req.set("direct-route", "yes");
                context.req.set("direct-route-order", ["first"]);
              },
            },
            {
              handler(_request, context) {
                const order = context.req.get<string[]>("direct-route-order") || [];
                context.req.set("direct-route-order", [...order, "second"]);
              },
            },
          ],
          handler(_request, context) {
            handlerSpy();
            return Response.json({
              ok: true,
              direct: context.req.get("direct-route") === "yes",
              middlewareOrder: context.req.get<string[]>("direct-route-order") || [],
            });
          },
        }),
      ],
    });

    const manager = new PluginManager({
      config: {
        integrations: {
          localDemo: integration,
        },
      } as any,
      isDev: true,
      isProd: false,
    });
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: integration,
      }),
    );
    await manager.runHookParallel("init");

    const apiServer = createIntegrationServerClient({
      integrations: {
        localDemo: integration,
      },
    });

    await _runWithCurrentRequest(new Request("https://farmjs.dev/server-demo"), async () => {
      const result = await apiServer.localDemo.message.get();

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        ok: true,
        direct: true,
        middlewareOrder: ["first", "second"],
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "request:start",
        route: expect.objectContaining({
          path: "/api/local-demo/message",
        }),
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "request:end",
        route: expect.objectContaining({
          path: "/api/local-demo/message",
        }),
      }),
    );
  });

  it("uses the current render request when isServer is true", async () => {
    stubServer();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const request = new Request("https://farmjs.dev/server-demo", {
      headers: {
        cookie: "demo=1",
        authorization: "Bearer server-token",
      },
    });

    await _runWithCurrentRequest(request, async () => {
      const api = createIntegrationClient(
        {
          integrations: {
            localDemo: {
              status: endpoint.get<{ ok: boolean }>("/api/local-demo/status", {
                responseFormat: "json",
                isServer: true,
              }),
            },
          },
        },
        {
          isServer: true,
        },
      );

      const result = await api.localDemo.status();

      expect(result.error).toBeNull();
      expect(result.data?.ok).toBe(true);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://farmjs.dev/api/local-demo/status",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      }),
    );

    const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get("cookie")).toBe("demo=1");
    expect(headers.get("authorization")).toBe("Bearer server-token");
  });

  it("rejects client callers on the server without isServer", async () => {
    stubServer();

    const api = createIntegrationClient({
      integrations: {
        supabase: {
          session: endpoint.get<{ authenticated: boolean }>("/auth/session", {
            responseFormat: "json",
          }),
        },
      },
    });

    await expect(api.supabase.session()).rejects.toThrow(
      "Client integration API cannot be called on the server.",
    );
  });

  it("rejects server integration clients in the browser", async () => {
    stubBrowser();

    const api = createIntegrationClient(
      {
        integrations: {
          analytics: {
            report: endpoint.get<{ authenticated: boolean }>("/analytics/report", {
              responseFormat: "json",
              isServer: true,
            }),
          },
        },
      },
      {
        isServer: true,
        request: new Request("https://farmjs.dev/dashboard"),
      },
    );

    await expect(api.analytics.report()).rejects.toThrow(
      "Server integration API cannot be called in the browser.",
    );
  });

  it("keeps non-server methods available on flat client aliases", async () => {
    stubBrowser();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    const api = createIntegrationClient({
      integrations: {
        billing: {
          health: endpoint.get<{ ok: boolean }>("/billing/health", {
            responseFormat: "json",
          }),
        },
      },
    });

    const result = await api.billing.health();

    expect(result.error).toBeNull();
    expect(result.data?.ok).toBe(true);
    expect(api.integrations.billing).toBe(api.billing);
  });
});
