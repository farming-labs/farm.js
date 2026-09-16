// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { auth0 } from "../../../farm-auth0/src/index";
import { workos, type WorkOSIntegrationInstance } from "../../../farm-workos/src/index";

const AUTH0_ENV = {
  domain: "tenant.auth0.com",
  clientId: "client_test",
  clientSecret: "secret_test",
  secret: "a".repeat(32),
  appBaseUrl: "https://app.example.com",
};

function createWorkOSStub() {
  const getLogoutUrl = vi.fn(async () => "https://auth.workos.com/logout");
  const authenticate = vi.fn(async () => ({ authenticated: true }));
  const loadSealedSession = vi.fn(() => ({ authenticate, getLogoutUrl }));

  const instance = {
    clientId: "client_test",
    userManagement: {
      getAuthorizationUrl: vi.fn(() => "https://auth.workos.com/authorize"),
      loadSealedSession,
    },
  } as unknown as WorkOSIntegrationInstance;

  return { instance, loadSealedSession, getLogoutUrl };
}

function findRoute(integration: { routes: readonly any[] }, path: string) {
  const route = integration.routes.find((candidate) => candidate.path === path);
  if (!route) {
    throw new Error(`route ${path} not found`);
  }
  return route;
}

describe("workos sign-out origin validation", () => {
  it("rejects a cross-site sign-out post without clearing the session", async () => {
    const { instance, loadSealedSession } = createWorkOSStub();
    const integration = workos({ instance, cookiePassword: "b".repeat(32) });
    const route = findRoute(integration, "/logout");

    const request = new Request("https://app.example.com/logout", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        cookie: "wos-session=sealed",
      },
    });

    const response = await route.handler(request, {} as never);

    expect(response.status).toBe(403);
    expect(loadSealedSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("allows a same-origin sign-out post", async () => {
    const { instance, loadSealedSession } = createWorkOSStub();
    const integration = workos({ instance, cookiePassword: "b".repeat(32) });
    const route = findRoute(integration, "/logout");

    const request = new Request("https://app.example.com/logout", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
        "sec-fetch-site": "same-origin",
        cookie: "wos-session=sealed",
      },
    });

    const response = await route.handler(request, {} as never);

    expect(response.status).not.toBe(403);
    expect(loadSealedSession).toHaveBeenCalledTimes(1);
  });

  it("accepts a configured trusted origin", async () => {
    const { instance, loadSealedSession } = createWorkOSStub();
    const integration = workos({
      instance,
      cookiePassword: "b".repeat(32),
      allowedOrigins: ["https://portal.example.com"],
    });
    const route = findRoute(integration, "/logout");

    const request = new Request("https://app.example.com/logout", {
      method: "POST",
      headers: {
        origin: "https://portal.example.com",
        "sec-fetch-site": "cross-site",
        cookie: "wos-session=sealed",
      },
    });

    const response = await route.handler(request, {} as never);

    expect(response.status).not.toBe(403);
    expect(loadSealedSession).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid allowedOrigins pattern at construction", () => {
    const { instance } = createWorkOSStub();

    expect(() =>
      workos({
        instance,
        cookiePassword: "b".repeat(32),
        allowedOrigins: ["https://example.com/path"],
      }),
    ).toThrow(/workos\.allowedOrigins/);
  });
});

describe("auth0 sign-out origin validation", () => {
  it("rejects a cross-site sign-out navigation without clearing the session", async () => {
    const integration = auth0(AUTH0_ENV);
    const route = findRoute(integration, "/auth/logout");

    const request = new Request("https://app.example.com/auth/logout", {
      headers: {
        referer: "https://attacker.example/post",
        "sec-fetch-site": "cross-site",
      },
    });

    const response = await route.handler(request, {} as never);

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("still signs out on a direct navigation with no origin metadata", async () => {
    const integration = auth0(AUTH0_ENV);
    const route = findRoute(integration, "/auth/logout");

    const request = new Request("https://app.example.com/auth/logout", {
      headers: { "sec-fetch-site": "none" },
    });

    const response = await route.handler(request, {} as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toContain("farm_auth0_session=");
  });

  it("still signs out on a same-origin navigation", async () => {
    const integration = auth0(AUTH0_ENV);
    const route = findRoute(integration, "/auth/logout");

    const request = new Request("https://app.example.com/auth/logout", {
      headers: {
        origin: "https://app.example.com",
        "sec-fetch-site": "same-origin",
      },
    });

    const response = await route.handler(request, {} as never);

    expect(response.status).toBe(302);
  });

  it("accepts a configured trusted origin", async () => {
    const integration = auth0({
      ...AUTH0_ENV,
      allowedOrigins: ["https://portal.example.com"],
    });
    const route = findRoute(integration, "/auth/logout");

    const request = new Request("https://app.example.com/auth/logout", {
      headers: {
        origin: "https://portal.example.com",
        "sec-fetch-site": "cross-site",
      },
    });

    const response = await route.handler(request, {} as never);

    expect(response.status).toBe(302);
  });
});
