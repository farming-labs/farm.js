// @vitest-environment node

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { auth0 } from "../../../farm-auth0/src/index";
import { dispatchIntegrationRequest, matchIntegrationRoute } from "../integrations";

const AUTH0_ENV = {
  domain: "tenant.us.auth0.com",
  clientId: "client_test",
  clientSecret: "client_secret_test",
  secret: "a-real-32-byte-secret-value-000000",
  appBaseUrl: "https://app.example.com",
} as const;

const PROTECTED = "/dashboard(.*)";

function buildIntegration(protectedRoutes: string | string[] = [PROTECTED]) {
  return auth0({ ...AUTH0_ENV, protectedRoutes });
}

function runtime(integration: ReturnType<typeof buildIntegration>) {
  return { integration, config: {}, isDev: false, isProd: true };
}

// Replicates auth0's internal `signValue` (payload.base64url "." HMAC-SHA256 hex)
// so an unexpired session cookie can be minted without relying on a non-exported
// helper. The cookie name (`farm_auth0_session`) matches the integration default.
function signSession(payload: object, secret: string): string {
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payloadPart).digest("hex");
  return `${payloadPart}.${signature}`;
}

function authenticatedRequest(url: string, method: string): Request {
  const cookie = signSession(
    { user: { sub: "user_test" }, expiresAt: Date.now() + 60 * 60 * 1000 },
    AUTH0_ENV.secret,
  );
  return new Request(url, { method, headers: { cookie: `farm_auth0_session=${cookie}` } });
}

describe("auth0 protected-route middleware redirect (method preservation regression)", () => {
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
      expect(location!).toContain("/auth/login");
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
    expect(response!.headers.get("location")).toContain("/auth/login");
  });

  it("registers the login route GET-only, so a method-preserved non-GET would bypass it", () => {
    const integration = buildIntegration();
    const config = { auth0: integration };
    expect(
      matchIntegrationRoute(config, { pathname: "/auth/login", method: "GET" }),
    ).not.toBeNull();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        matchIntegrationRoute(config, { pathname: "/auth/login", method }),
        `method ${method}`,
      ).toBeNull();
    }
  });

  it("303 mandates a GET on the Location: a GET to the login route runs the handler and 302-redirects to /authorize", async () => {
    const integration = buildIntegration();
    const response = await dispatchIntegrationRequest(
      runtime(integration),
      new Request("https://app.example.com/auth/login?returnTo=%2Fdashboard%2Fedit", {
        method: "GET",
      }),
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(302);
    expect(response!.headers.get("location")).toMatch(/\/authorize/);
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
    expect(location).toContain("/auth/login");

    // RFC 7231 §6.4.4: a 303 response is followed with a GET to the Location URI.
    const loginResponse = await dispatchIntegrationRequest(
      rt,
      new Request(location, { method: "GET" }),
    );
    expect(loginResponse).not.toBeNull();
    expect(loginResponse!.status).toBe(302);
    expect(loginResponse!.headers.get("location")).toMatch(/\/authorize/);
  });

  it("a method-preserved non-GET to /auth/login is still not handled (contract corroborates why 303 is required)", async () => {
    const integration = buildIntegration();
    const response = await dispatchIntegrationRequest(
      runtime(integration),
      new Request("https://app.example.com/auth/login?returnTo=%2Fdashboard%2Fedit", {
        method: "POST",
      }),
    );
    expect(response).toBeNull();
  });

  it("does not redirect authenticated requests to protected paths (no regression)", async () => {
    const integration = buildIntegration();
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const response = await dispatchIntegrationRequest(
        runtime(integration),
        authenticatedRequest("https://app.example.com/dashboard/edit", method),
      );
      expect(response, `method ${method}`).toBeNull();
    }
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
