// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  supabase,
  type SupabaseIntegrationClient,
  type SupabaseIntegrationInstanceContext,
} from "../../../farm-supabase/src/index";
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

function createContext(request: Request, path: string): FarmIntegrationHandlerContext {
  const req = createRequestContextStore();

  return {
    request,
    requestId: "req_csrf_test",
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

function createSupabaseStub() {
  const signInWithPassword = vi.fn(async () => ({ data: {}, error: null }));
  const signUp = vi.fn(async () => ({ data: { url: null }, error: null }));
  const signOut = vi.fn(async () => ({ error: null }));
  const getUser = vi.fn(async () => ({ data: { user: null }, error: null }));
  const factory = vi.fn(
    (_context: SupabaseIntegrationInstanceContext) =>
      ({
        auth: { signInWithPassword, signUp, signOut, getUser },
      }) as unknown as SupabaseIntegrationClient,
  );

  return { factory, signInWithPassword, signUp, signOut };
}

function credentialBody() {
  return new URLSearchParams({ email: "victim@example.com", password: "hunter2" });
}

describe("supabase auth route origin validation", () => {
  it("rejects a cross-site credential post without signing anyone in", async () => {
    const { factory, signInWithPassword } = createSupabaseStub();
    const integration = supabase({ instance: factory });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/login");

    const request = new Request("https://app.example.com/auth/login", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: credentialBody(),
    });

    const response = await route!.handler(request, createContext(request, "/auth/login"));

    expect(response.status).toBe(403);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("allows a same-origin credential post", async () => {
    const { factory, signInWithPassword } = createSupabaseStub();
    const integration = supabase({ instance: factory });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/login");

    const request = new Request("https://app.example.com/auth/login", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: credentialBody(),
    });

    const response = await route!.handler(request, createContext(request, "/auth/login"));

    expect(response.status).not.toBe(403);
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("rejects a credential post that carries no origin metadata", async () => {
    const { factory, signInWithPassword } = createSupabaseStub();
    const integration = supabase({ instance: factory });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/login");

    const request = new Request("https://app.example.com/auth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: credentialBody(),
    });

    const response = await route!.handler(request, createContext(request, "/auth/login"));

    expect(response.status).toBe(403);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("accepts a same-origin post proven only by Sec-Fetch-Site", async () => {
    const { factory, signInWithPassword } = createSupabaseStub();
    const integration = supabase({ instance: factory });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/login");

    const request = new Request("https://app.example.com/auth/login", {
      method: "POST",
      headers: {
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: credentialBody(),
    });

    const response = await route!.handler(request, createContext(request, "/auth/login"));

    expect(response.status).not.toBe(403);
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("rescues a TLS-offload POST via allowedOrigins when request.url stays http:", async () => {
    const { factory, signInWithPassword } = createSupabaseStub();
    const integration = supabase({
      instance: factory,
      allowedOrigins: ["https://app.example.com"],
    });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/login");

    // TLS-terminating proxy that leaves request.url as http: (trustProxy off,
    // or no X-Forwarded-Proto). The browser origin is https: and the Host
    // header matches, but `source.origin !== requestUrl.origin` (https vs http)
    // and matchesHostHeader rejects on the scheme mismatch, so the request is
    // only accepted because the configured allowed origin matches.
    const request = new Request("http://app.example.com/auth/login", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: credentialBody(),
    });

    const response = await route!.handler(request, createContext(request, "/auth/login"));

    expect(response.status).not.toBe(403);
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("rejects the same TLS-offload POST when the browser origin is not allowed", async () => {
    const { factory, signInWithPassword } = createSupabaseStub();
    const integration = supabase({ instance: factory });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/login");

    const request = new Request("http://app.example.com/auth/login", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: credentialBody(),
    });

    const response = await route!.handler(request, createContext(request, "/auth/login"));

    expect(response.status).toBe(403);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("accepts a configured trusted origin", async () => {
    const { factory, signInWithPassword } = createSupabaseStub();
    const integration = supabase({
      instance: factory,
      allowedOrigins: ["https://portal.example.com"],
    });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/login");

    const request = new Request("https://app.example.com/auth/login", {
      method: "POST",
      headers: {
        origin: "https://portal.example.com",
        "sec-fetch-site": "cross-site",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: credentialBody(),
    });

    const response = await route!.handler(request, createContext(request, "/auth/login"));

    expect(response.status).not.toBe(403);
    expect(signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid allowedOrigins pattern at construction", () => {
    const { factory } = createSupabaseStub();

    expect(() =>
      supabase({ instance: factory, allowedOrigins: ["https://example.com/path"] }),
    ).toThrow(/supabase\.allowedOrigins/);
  });

  it("rejects a cross-site sign-up post", async () => {
    const { factory, signUp } = createSupabaseStub();
    const integration = supabase({ instance: factory });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/signup");

    const request = new Request("https://app.example.com/auth/signup", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: credentialBody(),
    });

    const response = await route!.handler(request, createContext(request, "/auth/signup"));

    expect(response.status).toBe(403);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("rejects a cross-site sign-out post", async () => {
    const { factory, signOut } = createSupabaseStub();
    const integration = supabase({ instance: factory });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/logout");

    const request = new Request("https://app.example.com/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    });

    const response = await route!.handler(request, createContext(request, "/auth/logout"));

    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("rejects a cross-site sign-out navigation", async () => {
    const { factory, signOut } = createSupabaseStub();
    const integration = supabase({ instance: factory });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/logout");

    const request = new Request("https://app.example.com/auth/logout", {
      headers: {
        referer: "https://attacker.example/post",
        "sec-fetch-site": "cross-site",
      },
    });

    const response = await route!.handler(request, createContext(request, "/auth/logout"));

    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("still signs out on a direct sign-out navigation with no origin metadata", async () => {
    const { factory, signOut } = createSupabaseStub();
    const integration = supabase({ instance: factory });
    const route = integration.routes.find((candidate) => candidate.path === "/auth/logout");

    const request = new Request("https://app.example.com/auth/logout", {
      headers: { "sec-fetch-site": "none" },
    });

    const response = await route!.handler(request, createContext(request, "/auth/logout"));

    expect(response.status).toBe(302);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
