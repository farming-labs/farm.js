import { afterEach, describe, expect, it, vi } from "vitest";
import { defineIntegration } from "../integrations";
import {
  createIntegrationApi,
  createIntegrationClient,
  createIntegrationServerClient,
  endpoint,
  IntegrationClientError,
} from "../client";

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
      'registered with isServer: true',
    );

    const directResult = await directServerApi.analytics.report();
    const flaggedResult = await flaggedServerApi.analytics.report();
    const wrappedResult = await wrappedApi.server({
      request,
    }).analytics.report();

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
