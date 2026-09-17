// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { workos, type WorkOSIntegrationInstance } from "../../../farm-workos/src/index";

const COOKIE_PASSWORD = "b".repeat(32);

function createStub() {
  const getAuthorizationUrl = vi.fn(
    (options: { state?: string }) =>
      `https://auth.workos.com/authorize?state=${encodeURIComponent(options.state ?? "")}`,
  );
  const authenticateWithCode = vi.fn(async () => ({
    sealedSession: "sealed-session-value",
  }));

  const instance = {
    clientId: "client_test",
    userManagement: { getAuthorizationUrl, authenticateWithCode },
  } as unknown as WorkOSIntegrationInstance;

  return { instance, getAuthorizationUrl, authenticateWithCode };
}

function createIntegration(instance: WorkOSIntegrationInstance) {
  return workos({ instance, cookiePassword: COOKIE_PASSWORD });
}

function findRoute(integration: { routes: readonly any[] }, path: string) {
  const route = integration.routes.find((candidate) => candidate.path === path);
  if (!route) {
    throw new Error(`route ${path} not found`);
  }
  return route;
}

/** Run the login redirect and return the issued state plus its cookie. */
async function startFlow(integration: { routes: readonly any[] }) {
  const route = findRoute(integration, "/login");
  const request = new Request("https://app.example.com/login?returnTo=/reports");
  const response = await route.handler(request, {} as never);

  const setCookie = response.headers.get("set-cookie") ?? "";
  const stateCookie = setCookie.split(";")[0] ?? "";
  const location = response.headers.get("location") ?? "";
  const state = new URL(location).searchParams.get("state") ?? "";

  return { stateCookie, state, response };
}

describe("workos callback state binding", () => {
  it("issues an unguessable state and stores it in a signed cookie", async () => {
    const { instance, getAuthorizationUrl } = createStub();
    const { stateCookie, state } = await startFlow(createIntegration(instance));

    expect(state.length).toBeGreaterThan(20);
    expect(stateCookie).toContain("farm_workos_state=");
    // The raw returnTo must not be readable as plain JSON state any more.
    expect(() => JSON.parse(state)).toThrow();
    expect(getAuthorizationUrl).toHaveBeenCalledTimes(1);
  });

  it("rejects a callback with no state cookie, without creating a session", async () => {
    const { instance, authenticateWithCode } = createStub();
    const integration = createIntegration(instance);
    const { state } = await startFlow(integration);
    const route = findRoute(integration, "/callback");

    const request = new Request(
      `https://app.example.com/callback?code=attacker_code&state=${encodeURIComponent(state)}`,
    );
    const response = await route.handler(request, {} as never);

    expect(response.status).toBe(400);
    expect(authenticateWithCode).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an attacker's code replayed into a victim's browser", async () => {
    const { instance, authenticateWithCode } = createStub();
    const integration = createIntegration(instance);

    // The victim has their own in-flight flow, so they do hold a state cookie.
    const victim = await startFlow(integration);
    // The attacker ran a separate flow and holds a code plus their own state.
    const attacker = await startFlow(integration);

    const route = findRoute(integration, "/callback");
    const request = new Request(
      `https://app.example.com/callback?code=attacker_code&state=${encodeURIComponent(attacker.state)}`,
      { headers: { cookie: victim.stateCookie } },
    );
    const response = await route.handler(request, {} as never);

    expect(response.status).toBe(400);
    expect(authenticateWithCode).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a forged state cookie that was not signed by this app", async () => {
    const { instance, authenticateWithCode } = createStub();
    const integration = createIntegration(instance);
    const route = findRoute(integration, "/callback");

    const forged = Buffer.from(JSON.stringify({ state: "forged", returnTo: "/" }), "utf8").toString(
      "base64url",
    );
    const request = new Request("https://app.example.com/callback?code=c&state=forged", {
      headers: { cookie: `farm_workos_state=${forged}.deadbeef` },
    });
    const response = await route.handler(request, {} as never);

    expect(response.status).toBe(400);
    expect(authenticateWithCode).not.toHaveBeenCalled();
  });

  it("completes a genuine callback and clears the state cookie", async () => {
    const { instance, authenticateWithCode } = createStub();
    const integration = createIntegration(instance);
    const { stateCookie, state } = await startFlow(integration);
    const route = findRoute(integration, "/callback");

    const request = new Request(
      `https://app.example.com/callback?code=real_code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: stateCookie } },
    );
    const response = await route.handler(request, {} as never);

    expect(response.status).toBe(302);
    expect(authenticateWithCode).toHaveBeenCalledTimes(1);

    const cookies = response.headers.getSetCookie();
    expect(cookies.some((value) => value.startsWith("wos-session="))).toBe(true);
    // The state cookie is single use and must be cleared.
    expect(cookies.some((value) => value.startsWith("farm_workos_state="))).toBe(true);
  });

  it("takes returnTo from the signed cookie, not the query state", async () => {
    const { instance } = createStub();
    const integration = createIntegration(instance);
    const { stateCookie, state } = await startFlow(integration);
    const route = findRoute(integration, "/callback");

    const request = new Request(
      `https://app.example.com/callback?code=real_code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: stateCookie } },
    );
    const response = await route.handler(request, {} as never);

    expect(response.headers.get("location")).toBe("https://app.example.com/reports");
  });
});
