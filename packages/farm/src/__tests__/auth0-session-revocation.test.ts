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

function runtime(input: Parameters<typeof auth0>[0] = {}) {
  const integration = auth0({ ...AUTH0_ENV, protectedRoutes: ["/dashboard(.*)"], ...input });
  return { integration, config: {}, isDev: false, isProd: true };
}

function setCookie(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  expect(header, `${name} cookie`).toBeDefined();
  return header!;
}

/** Sign in through the real login and callback routes; returns the session cookie header. */
async function signIn(rt: ReturnType<typeof runtime>) {
  const login = await dispatchIntegrationRequest(
    rt,
    new Request("https://app.example.com/auth/login"),
  );
  const state = new URL(login!.headers.get("location")!).searchParams.get("state")!;
  const stateCookie = setCookie(login!, "farm_auth0_state").split(";")[0]!;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        return Response.json({ access_token: "access", expires_in: 86_400 });
      }
      if (url.endsWith("/userinfo")) return Response.json({ sub: "auth0|user" });
      return new Response("unexpected", { status: 500 });
    }),
  );
  const callback = await dispatchIntegrationRequest(
    rt,
    new Request(`https://app.example.com/auth/callback?code=abc&state=${state}`, {
      headers: { cookie: stateCookie },
    }),
  );
  return setCookie(callback!, "farm_auth0_session");
}

async function profileStatus(rt: ReturnType<typeof runtime>, cookie: string) {
  const response = await dispatchIntegrationRequest(
    rt,
    new Request("https://app.example.com/auth/profile", { headers: { cookie } }),
  );
  return response!.status;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("auth0 session lifetime and revocation", () => {
  it("keeps the token lifetime by default", async () => {
    const rt = runtime();
    expect(await signIn(rt)).toContain("Max-Age=86400");
  });

  it("caps a session at sessionMaxAge", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const rt = runtime({ sessionMaxAge: 600 });
    const header = await signIn(rt);
    expect(header).toContain("Max-Age=600");
    const cookie = header.split(";")[0]!;

    expect(await profileStatus(rt, cookie)).toBe(200);
    vi.setSystemTime(Date.now() + 601_000);
    // A copy of the cookie stops working once the max age passes, whatever Max-Age said.
    expect(await profileStatus(rt, cookie)).toBe(401);
  });

  it("rejects a session the app revoked on sign-out", async () => {
    const revoked = new Set<string>();
    const onSignOut = vi.fn((session: { sessionId?: string }) => {
      if (session.sessionId) revoked.add(session.sessionId);
    });
    const rt = runtime({
      onSignOut,
      isSessionRevoked: (session) => Boolean(session.sessionId && revoked.has(session.sessionId)),
    });
    const cookie = (await signIn(rt)).split(";")[0]!;
    expect(await profileStatus(rt, cookie)).toBe(200);

    const logout = await dispatchIntegrationRequest(
      rt,
      new Request("https://app.example.com/auth/logout", { headers: { cookie } }),
    );
    expect(logout!.status).toBe(302);
    expect(onSignOut).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: expect.any(String), user: { sub: "auth0|user" } }),
      expect.any(Request),
    );

    // The copied cookie no longer signs anyone in.
    expect(await profileStatus(rt, cookie)).toBe(401);
    const guarded = await dispatchIntegrationRequest(
      rt,
      new Request("https://app.example.com/dashboard", { headers: { cookie } }),
    );
    expect(guarded!.status).toBe(303);
  });

  it("rejects a sessionMaxAge that is not a number of seconds", () => {
    expect(() => auth0({ ...AUTH0_ENV, sessionMaxAge: 0 })).toThrow(/sessionMaxAge/);
    expect(() => auth0({ ...AUTH0_ENV, sessionMaxAge: Number.NaN })).toThrow(/sessionMaxAge/);
  });
});
