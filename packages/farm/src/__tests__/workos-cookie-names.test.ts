// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { workos, type WorkOSIntegrationInstance } from "../../../farm-workos/src/index";

const COOKIE_PASSWORD = "b".repeat(32);
const SESSION = "__Host-wos-session";
const STATE = "__Host-farm_workos_state";

function createIntegration(input: Parameters<typeof workos>[0] = {}) {
  const instance = {
    clientId: "client_test",
    userManagement: {
      getAuthorizationUrl: vi.fn(
        (options: { state?: string }) =>
          `https://auth.workos.com/authorize?state=${encodeURIComponent(options.state ?? "")}`,
      ),
      authenticateWithCode: vi.fn(async () => ({ sealedSession: "sealed-session-value" })),
    },
  } as unknown as WorkOSIntegrationInstance;
  return workos({ instance, cookiePassword: COOKIE_PASSWORD, ...input });
}

function route(integration: { routes: readonly any[] }, path: string) {
  const found = integration.routes.find((candidate) => candidate.path === path);
  if (!found) throw new Error(`route ${path} not found`);
  return found;
}

function setCookie(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  expect(header, `${name} cookie`).toBeDefined();
  return header!;
}

function expectHostCookie(header: string) {
  const attributes = header.split("; ").slice(1);
  expect(attributes).toContain("Path=/");
  expect(attributes).toContain("Secure");
  expect(attributes.some((attribute) => attribute.startsWith("Domain="))).toBe(false);
}

describe("workos cookie names", () => {
  it("sets, reads, and clears the configured __Host- state cookie", async () => {
    const integration = createIntegration({ cookieName: SESSION, stateCookieName: STATE });
    const login = await route(integration, "/login").handler(
      new Request("https://app.example.com/login?returnTo=/reports"),
      {} as never,
    );
    const stateHeader = setCookie(login, STATE);
    expectHostCookie(stateHeader);
    const stateCookie = stateHeader.split(";")[0]!;
    const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
    const callbackUrl = `https://app.example.com/callback?code=code&state=${encodeURIComponent(state)}`;

    // The default name is not read: only the configured state cookie completes the login.
    const wrongName = await route(integration, "/callback").handler(
      new Request(callbackUrl, {
        headers: { cookie: stateCookie.replace(STATE, "farm_workos_state") },
      }),
      {} as never,
    );
    expect(wrongName.status).toBe(400);

    const callback = await route(integration, "/callback").handler(
      new Request(callbackUrl, { headers: { cookie: stateCookie } }),
      {} as never,
    );
    expectHostCookie(setCookie(callback, SESSION));
    const cleared = setCookie(callback, STATE);
    expect(cleared).toContain("Max-Age=0");
    expectHostCookie(cleared);
  });

  it("keeps the default state cookie name", async () => {
    const login = await route(createIntegration(), "/login").handler(
      new Request("https://app.example.com/login"),
      {} as never,
    );
    setCookie(login, "farm_workos_state");
  });

  it("rejects invalid or clashing names", () => {
    expect(() => createIntegration({ stateCookieName: "bad name" })).toThrow(/valid cookie name/);
    expect(() => createIntegration({ cookieName: "a;b" })).toThrow(/valid cookie name/);
    expect(() => createIntegration({ cookieName: "same", stateCookieName: "same" })).toThrow(
      /must differ/,
    );
  });
});
