// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { clerk, type ClerkIntegrationInstance } from "../../../farm-clerk/src/index";
import { polar, type PolarIntegrationInstance } from "../../../farm-polar/src/index";
import {
  supabase,
  type SupabaseIntegrationClient,
  type SupabaseIntegrationInstanceContext,
} from "../../../farm-supabase/src/index";
import { unkey, type UnkeyIntegrationInstance } from "../../../farm-unkey/src/index";
import { workos, type WorkOSIntegrationInstance } from "../../../farm-workos/src/index";
import type { FarmIntegrationHandlerContext } from "../integrations";

function createRequestContextStore() {
  const values = new Map<string, unknown>();

  return {
    get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    set(key: string, value: unknown) {
      values.set(key, value);
    },
    has(key: string) {
      return values.has(key);
    },
    delete(key: string) {
      return values.delete(key);
    },
    clear() {
      values.clear();
    },
    snapshot() {
      return new Map(values);
    },
  };
}

function createContext(
  request: Request,
  type: string,
  path: string,
): FarmIntegrationHandlerContext {
  const req = createRequestContextStore();

  return {
    request,
    requestId: "req_instance_test",
    url: new URL(request.url),
    pathname: new URL(request.url).pathname,
    method: request.method,
    params: {},
    input: {},
    args: {},
    data: {},
    integration: {
      category: "auth",
      slot: "auth",
      type,
      instance: {},
    },
    route: {
      kind: "route",
      path,
      methods: [request.method],
    },
    req,
    requestContext: req,
    config: {} as FarmIntegrationHandlerContext["config"],
    isDev: true,
    isProd: false,
  };
}

describe("integration instance injection", () => {
  it("uses an injected WorkOS SDK without requiring an API key", async () => {
    const getAuthorizationUrl = vi.fn(() => "https://auth.example.com/authorize");
    const instance = {
      clientId: "client_test",
      userManagement: {
        getAuthorizationUrl,
      },
    } as unknown as WorkOSIntegrationInstance;
    const integration = workos({
      instance,
      clientId: "client_other",
      cookiePassword: "test-cookie-password-that-is-long-enough",
    });
    const route = integration.routes.find((candidate) => candidate.path === "/login");
    const request = new Request("https://app.example.com/login?returnTo=/dashboard", {
      headers: {
        "x-farm-integration-client": "1",
      },
    });

    const response = await route!.handler(request, createContext(request, "workos", "/login"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectTo: "https://auth.example.com/authorize" });
    expect(getAuthorizationUrl).toHaveBeenCalledOnce();
    expect(getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client_test" }),
    );
  });

  it("uses an injected Clerk backend client without requiring a secret key", async () => {
    const authenticateRequest = vi.fn(async () => ({
      isAuthenticated: true,
      headers: new Headers(),
      status: "signed-in",
    }));
    const instance = {
      authenticateRequest,
    } as unknown as ClerkIntegrationInstance;
    const integration = clerk({
      instance,
      publishableKey: "pk_test",
      protectedRoutes: ["/dashboard(.*)"],
    });
    const request = new Request("https://app.example.com/dashboard");

    const response = await integration.middleware![0].handler(
      request,
      createContext(request, "clerk", "/dashboard"),
    );

    expect(response).toBeUndefined();
    expect(authenticateRequest).toHaveBeenCalledOnce();
  });

  it("accepts an injected Polar SDK without requiring an access token", () => {
    const instance = {} as PolarIntegrationInstance;

    expect(() =>
      polar({
        instance,
        billing: {
          resolveOwner: () => null,
        },
      }),
    ).not.toThrow();
  });

  it("creates a fresh injected Supabase client for each request", async () => {
    const getUser = vi.fn(async () => ({
      data: { user: { id: "user_test" } },
      error: null,
    }));
    const factory = vi.fn(
      (_context: SupabaseIntegrationInstanceContext) =>
        ({ auth: { getUser } }) as unknown as SupabaseIntegrationClient,
    );
    const integration = supabase({ instance: factory });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/session");

    for (const id of ["one", "two"]) {
      const request = new Request(`https://app.example.com/auth/session?request=${id}`);
      const response = await route!.handler(
        request,
        createContext(request, "supabase", "/auth/session"),
      );

      expect(response.status).toBe(200);
    }

    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory.mock.calls[0][0].request).not.toBe(factory.mock.calls[1][0].request);
    expect(factory.mock.calls[0][0].options.cookies).toMatchObject({
      getAll: expect.any(Function),
      setAll: expect.any(Function),
    });
  });

  it("prefers the Unkey instance option for protected routes", async () => {
    const verifyKey = vi.fn(async () => ({
      valid: true,
      keyId: "key_test",
    }));
    const instance = {
      verifyKey,
    } as unknown as UnkeyIntegrationInstance;
    const integration = unkey({
      instance,
      protectedRoutes: ["/api/private(.*)"],
    });
    const request = new Request("https://app.example.com/api/private", {
      headers: {
        authorization: "Bearer api_test",
      },
    });

    const response = await integration.middleware![0].handler(
      request,
      createContext(request, "unkey", "/api/private"),
    );

    expect(response).toBeUndefined();
    expect(verifyKey).toHaveBeenCalledWith({
      key: "api_test",
      permissions: undefined,
      tags: undefined,
    });
  });
});
