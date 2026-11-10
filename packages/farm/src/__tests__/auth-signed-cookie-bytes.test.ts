// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { auth0 } from "../../../farm-auth0/src/index";
import { workos, type WorkOSIntegrationInstance } from "../../../farm-workos/src/index";
import { dispatchIntegrationRequest } from "../integrations";

// A hex HMAC-SHA256 signature is 64 characters. 64 percent-encoded "é" decode
// to a 64-character string that is 128 bytes, so a string-length check passes
// and node's timingSafeEqual then throws ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH.
const MULTIBYTE_SIGNATURE = "%C3%A9".repeat(64);
const PAYLOAD = Buffer.from(JSON.stringify({ state: "s", returnTo: "/" })).toString("base64url");

describe("auth0 signed cookies with a multibyte signature", () => {
  it("treat the session as missing and redirect to login", async () => {
    const integration = auth0({
      domain: "tenant.us.auth0.com",
      clientId: "client_test",
      clientSecret: "client_secret_test",
      secret: "a-real-32-byte-secret-value-000000",
      appBaseUrl: "https://app.example.com",
      protectedRoutes: ["/dashboard(.*)"],
    });

    const response = await dispatchIntegrationRequest(
      { integration, config: {}, isDev: false, isProd: true },
      new Request("https://app.example.com/dashboard", {
        headers: { cookie: `farm_auth0_session=${PAYLOAD}.${MULTIBYTE_SIGNATURE}` },
      }),
    );

    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toContain("/auth/login");
  });
});

describe("workos signed state cookie with a multibyte signature", () => {
  it("rejects the callback without creating a session", async () => {
    const authenticateWithCode = vi.fn();
    const integration = workos({
      instance: {
        clientId: "client_test",
        userManagement: { getAuthorizationUrl: vi.fn(), authenticateWithCode },
      } as unknown as WorkOSIntegrationInstance,
      cookiePassword: "b".repeat(32),
    });
    const route = integration.routes.find((candidate: any) => candidate.path === "/callback")!;

    const response = await route.handler(
      new Request("https://app.example.com/callback?code=c&state=s", {
        headers: { cookie: `farm_workos_state=${PAYLOAD}.${MULTIBYTE_SIGNATURE}` },
      }),
      {} as never,
    );

    expect(response.status).toBe(400);
    expect(authenticateWithCode).not.toHaveBeenCalled();
  });
});
