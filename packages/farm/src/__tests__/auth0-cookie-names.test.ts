// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { auth0 } from "../../../farm-auth0/src/index";
import { dispatchIntegrationRequest } from "../integrations";

const AUTH0_ENV = {
  domain: "tenant.us.auth0.com",
  clientId: "client_test",
  clientSecret: "client_secret_test",
  secret: "a-real-32-byte-secret-value-000000",
  appBaseUrl: "https://app.example.com",
} as const;
const SESSION = "__Host-farm_auth0_session";
const STATE = "__Host-farm_auth0_state";

function runtime(input: Parameters<typeof auth0>[0] = {}) {
  const integration = auth0({ ...AUTH0_ENV, protectedRoutes: ["/dashboard(.*)"], ...input });
  return { integration, config: {}, isDev: false, isProd: true };
}

function setCookie(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  expect(header, `${name} cookie`).toBeDefined();
  return header!;
}

/** A `__Host-` cookie is kept by the browser only with Secure, Path=/ and no Domain. */
function expectHostCookie(header: string) {
  const attributes = header.split("; ").slice(1);
  expect(attributes).toContain("Path=/");
  expect(attributes).toContain("Secure");
  expect(attributes.some((attribute) => attribute.startsWith("Domain="))).toBe(false);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth0 cookie names", () => {
  it("sets, reads, and clears the configured __Host- cookies", async () => {
    const rt = runtime({ cookieName: SESSION, stateCookieName: STATE });

    const login = await dispatchIntegrationRequest(
      rt,
      new Request("https://app.example.com/auth/login?returnTo=%2Fdashboard"),
    );
    const stateHeader = setCookie(login!, STATE);
    expectHostCookie(stateHeader);
    expect(login!.headers.getSetCookie().some((value) => value.startsWith("farm_auth0_"))).toBe(
      false,
    );
    const state = new URL(login!.headers.get("location")!).searchParams.get("state")!;
    const stateCookie = stateHeader.slice(STATE.length + 1).split(";")[0]!;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/oauth/token")) {
          return Response.json({ access_token: "access", expires_in: 3600 });
        }
        if (url.endsWith("/userinfo")) return Response.json({ sub: "auth0|user" });
        return new Response("unexpected", { status: 500 });
      }),
    );
    // The default name is not read: only the configured state cookie completes the login.
    const wrongName = await dispatchIntegrationRequest(
      rt,
      new Request(`https://app.example.com/auth/callback?code=abc&state=${state}`, {
        headers: { cookie: `farm_auth0_state=${stateCookie}` },
      }),
    );
    expect(wrongName?.status).toBe(400);

    const callback = await dispatchIntegrationRequest(
      rt,
      new Request(`https://app.example.com/auth/callback?code=abc&state=${state}`, {
        headers: { cookie: `${STATE}=${stateCookie}` },
      }),
    );
    expect(callback?.status).toBe(302);
    const sessionHeader = setCookie(callback!, SESSION);
    expectHostCookie(sessionHeader);
    expectHostCookie(setCookie(callback!, STATE));
    const session = sessionHeader.slice(SESSION.length + 1).split(";")[0]!;

    const profile = await dispatchIntegrationRequest(
      rt,
      new Request("https://app.example.com/auth/profile", {
        headers: { cookie: `${SESSION}=${session}` },
      }),
    );
    expect(await profile?.json()).toMatchObject({
      authenticated: true,
      user: { sub: "auth0|user" },
    });
    const defaultName = await dispatchIntegrationRequest(
      rt,
      new Request("https://app.example.com/auth/profile", {
        headers: { cookie: `farm_auth0_session=${session}` },
      }),
    );
    expect(defaultName?.status).toBe(401);

    const logout = await dispatchIntegrationRequest(
      rt,
      new Request("https://app.example.com/auth/logout", {
        headers: { cookie: `${SESSION}=${session}` },
      }),
    );
    const cleared = setCookie(logout!, SESSION);
    expect(cleared).toContain("Max-Age=0");
    expectHostCookie(cleared);
  });

  it("keeps the __Host- attributes on a plain http development origin", async () => {
    const rt = runtime({ appBaseUrl: "http://localhost:3000", stateCookieName: STATE });
    const login = await dispatchIntegrationRequest(
      rt,
      new Request("http://localhost:3000/auth/login"),
    );
    // Browsers accept Secure cookies from http://localhost; elsewhere use https or the default names.
    expectHostCookie(setCookie(login!, STATE));
  });

  it("keeps the default names", async () => {
    const login = await dispatchIntegrationRequest(
      runtime(),
      new Request("https://app.example.com/auth/login"),
    );
    setCookie(login!, "farm_auth0_state");
  });

  it("rejects invalid or clashing names", () => {
    expect(() => auth0({ ...AUTH0_ENV, cookieName: "bad name" })).toThrow(/valid cookie name/);
    expect(() => auth0({ ...AUTH0_ENV, cookieName: "a;b" })).toThrow(/valid cookie name/);
    expect(() => auth0({ ...AUTH0_ENV, cookieName: "same", stateCookieName: "same" })).toThrow(
      /must differ/,
    );
  });
});
