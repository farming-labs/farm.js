// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  supabase,
  type SupabaseIntegrationClient,
  type SupabaseIntegrationInstanceContext,
} from "../../../farm-supabase/src/index";
import {
  FARM_INTEGRATION_SET_COOKIES_KEY,
  forwardIntegrationSetCookies,
  type FarmIntegrationHandlerContext,
} from "../integrations";

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

function createContext(request: Request, path: string): FarmIntegrationHandlerContext {
  const req = createRequestContextStore();

  return {
    request,
    requestId: "req_supabase_refresh_test",
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
      type: "supabase",
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

describe("supabase protected-route middleware refresh forwarding", () => {
  it("accumulates cookie rotations forwarded by multiple middleware", () => {
    const ctx = createContext(new Request("https://app.example.com/dashboard"), "/dashboard");

    forwardIntegrationSetCookies(ctx, ["first=one; Path=/"]);
    forwardIntegrationSetCookies(ctx, ["second=two; Path=/", "third=three; Path=/"]);

    expect(ctx.req.get<string[]>(FARM_INTEGRATION_SET_COOKIES_KEY)).toEqual([
      "first=one; Path=/",
      "second=two; Path=/",
      "third=three; Path=/",
    ]);
  });

  it("forwards refreshed session cookies on the authenticated branch so the runtime can set them", async () => {
    const factory = vi.fn((context: SupabaseIntegrationInstanceContext) => {
      const getUser = async () => {
        // getUser() silently refreshes the near-expiry access token server-side,
        // emitting a rotated session cookie through the cookie adapter's setAll.
        context.options.cookies!.setAll!([
          {
            name: "sb-test-auth-token",
            value: "rotated-session-value",
            options: { path: "/" },
          },
        ]);
        return { data: { user: { id: "user_verified" } }, error: null };
      };
      return { auth: { getUser } } as unknown as SupabaseIntegrationClient;
    });
    const integration = supabase({
      instance: factory,
      protectedRoutes: ["/dashboard(.*)"],
    });
    const request = new Request("https://app.example.com/dashboard", {
      headers: { cookie: "sb-test-auth-token=stale" },
    });
    const ctx = createContext(request, "/dashboard");

    const response = await integration.middleware![0].handler(request, ctx);

    // The authenticated branch returns void so the protected route still renders;
    // the rotated cookie must reach the browser through the runtime instead.
    expect(response).toBeUndefined();
    const forwarded = ctx.req.get<string[]>(FARM_INTEGRATION_SET_COOKIES_KEY);
    expect(forwarded).toBeInstanceOf(Array);
    expect(forwarded!.length).toBe(1);
    expect(forwarded![0]).toContain("sb-test-auth-token=rotated-session-value");
  });

  it("does not forward anything when getUser verifies without refreshing", async () => {
    const getUser = vi.fn(async () => ({
      data: { user: { id: "user_verified" } },
      error: null,
    }));
    const factory = vi.fn(() => ({ auth: { getUser } }) as unknown as SupabaseIntegrationClient);
    const integration = supabase({
      instance: factory,
      protectedRoutes: ["/dashboard(.*)"],
    });
    const request = new Request("https://app.example.com/dashboard");
    const ctx = createContext(request, "/dashboard");

    const response = await integration.middleware![0].handler(request, ctx);

    expect(response).toBeUndefined();
    expect(ctx.req.get(FARM_INTEGRATION_SET_COOKIES_KEY)).toBeUndefined();
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("still attaches Set-Cookie to the redirect on the failure branch (regression guard)", async () => {
    const factory = vi.fn((context: SupabaseIntegrationInstanceContext) => {
      const getUser = async () => {
        context.options.cookies!.setAll!([
          {
            name: "sb-test-auth-token",
            value: "",
            options: { maxAge: 0, path: "/" },
          },
        ]);
        return { data: { user: null }, error: { message: "session expired" } };
      };
      return { auth: { getUser } } as unknown as SupabaseIntegrationClient;
    });
    const integration = supabase({
      instance: factory,
      protectedRoutes: ["/dashboard(.*)"],
    });
    const request = new Request("https://app.example.com/dashboard", {
      headers: { cookie: "sb-test-auth-token=stale" },
    });
    const ctx = createContext(request, "/dashboard");

    const response = await integration.middleware![0].handler(request, ctx);

    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(302);
    expect(response!.headers.get("set-cookie")).toContain("sb-test-auth-token=");
    expect(response!.headers.get("set-cookie")).toContain("Max-Age=0");
    // The failure branch carries its cookies on its own redirect Response and
    // must not also push them through the void-path forward channel.
    expect(ctx.req.get(FARM_INTEGRATION_SET_COOKIES_KEY)).toBeUndefined();
  });

  it("forwards multiple rotated cookies set during a single getUser refresh", async () => {
    const factory = vi.fn((context: SupabaseIntegrationInstanceContext) => {
      const getUser = async () => {
        context.options.cookies!.setAll!([
          {
            name: "sb-test-auth-token",
            value: "rotated-auth",
            options: { path: "/" },
          },
          {
            name: "sb-test-refresh-token",
            value: "rotated-refresh",
            options: { path: "/", httpOnly: true },
          },
        ]);
        return { data: { user: { id: "user_verified" } }, error: null };
      };
      return { auth: { getUser } } as unknown as SupabaseIntegrationClient;
    });
    const integration = supabase({
      instance: factory,
      protectedRoutes: ["/dashboard(.*)"],
    });
    const request = new Request("https://app.example.com/dashboard", {
      headers: { cookie: "sb-test-auth-token=stale" },
    });
    const ctx = createContext(request, "/dashboard");

    const response = await integration.middleware![0].handler(request, ctx);

    expect(response).toBeUndefined();
    const forwarded = ctx.req.get<string[]>(FARM_INTEGRATION_SET_COOKIES_KEY);
    expect(forwarded).toBeInstanceOf(Array);
    expect(forwarded!.length).toBe(2);
    expect(forwarded!.join("\n")).toContain("sb-test-auth-token=rotated-auth");
    expect(forwarded!.join("\n")).toContain("sb-test-refresh-token=rotated-refresh");
  });
});
