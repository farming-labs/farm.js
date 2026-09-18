// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { dispatchIntegrationRequest, matchIntegrationRoute } from "../integrations";
import { workos, type WorkOSIntegrationInstance } from "../../../farm-workos/src/index";

// farm-workos shares the exact Auth0 defect: its protected-route middleware
// redirected unauthenticated requests with 307 against a GET-only `/login`
// route. This mirrors the auth0 repro to confirm the 303 fix.
function createWorkOSStub(): WorkOSIntegrationInstance {
  return {
    clientId: "client_test",
    userManagement: {
      getAuthorizationUrl: vi.fn(() => "https://auth.workos.com/authorize"),
      loadSealedSession: vi.fn(() => ({
        authenticate: vi.fn(async () => ({ authenticated: true })),
        getLogoutUrl: vi.fn(async () => "https://auth.workos.com/logout"),
      })),
    },
  } as unknown as WorkOSIntegrationInstance;
}

function buildIntegration(protectedRoutes: string | string[] = ["/dashboard(.*)"]) {
  return workos({
    instance: createWorkOSStub(),
    cookiePassword: "b".repeat(32),
    protectedRoutes,
  });
}

function runtime(integration: ReturnType<typeof buildIntegration>) {
  return { integration, config: {}, isDev: false, isProd: true };
}

describe("workos protected-route middleware redirect (method preservation regression)", () => {
  it("redirects unauthenticated non-GET requests with 303 (See Other), not 307", async () => {
    const integration = buildIntegration();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await dispatchIntegrationRequest(
        runtime(integration),
        new Request("https://app.example.com/dashboard/edit", { method }),
      );
      expect(response, `method ${method}`).not.toBeNull();
      expect(response!.status, `method ${method}`).toBe(303);
      const location = response!.headers.get("location");
      expect(location, `method ${method}`).not.toBeNull();
      expect(location!).toContain("/login");
      expect(location!).toContain("returnTo=%2Fdashboard%2Fedit");
    }
  });

  it("redirects unauthenticated GET requests with 303 too (no regression for the common case)", async () => {
    const integration = buildIntegration();
    const response = await dispatchIntegrationRequest(
      runtime(integration),
      new Request("https://app.example.com/dashboard/edit", { method: "GET" }),
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(303);
    expect(response!.headers.get("location")).toContain("/login");
  });

  it("registers the login route GET-only, so a method-preserved non-GET would bypass it", () => {
    const integration = buildIntegration();
    const config = { workos: integration };
    expect(matchIntegrationRoute(config, { pathname: "/login", method: "GET" })).not.toBeNull();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        matchIntegrationRoute(config, { pathname: "/login", method }),
        `method ${method}`,
      ).toBeNull();
    }
  });

  it("the full fixed flow: non-GET protected -> 303 -> GET login -> 302 /authorize (login flow not bypassed)", async () => {
    const integration = buildIntegration();
    const rt = runtime(integration);

    const protectedResponse = await dispatchIntegrationRequest(
      rt,
      new Request("https://app.example.com/dashboard/edit", { method: "PATCH" }),
    );
    expect(protectedResponse).not.toBeNull();
    expect(protectedResponse!.status).toBe(303);
    const location = protectedResponse!.headers.get("location")!;
    expect(location).toContain("/login");

    // 303 mandates a GET to the Location (RFC 7231 §6.4.4).
    const loginResponse = await dispatchIntegrationRequest(
      rt,
      new Request(location, { method: "GET" }),
    );
    expect(loginResponse).not.toBeNull();
    expect(loginResponse!.status).toBe(302);
    expect(loginResponse!.headers.get("location")).toBe("https://auth.workos.com/authorize");
  });

  it("emits no middleware redirect when no protected routes are configured", async () => {
    const integration = buildIntegration([]);
    const response = await dispatchIntegrationRequest(
      runtime(integration),
      new Request("https://app.example.com/dashboard/edit", { method: "POST" }),
    );
    expect(response).toBeNull();
  });
});
