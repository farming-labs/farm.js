// @vitest-environment node

import { createHmac } from "node:crypto";
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

function runtime() {
  const integration = auth0({ ...AUTH0_ENV, protectedRoutes: ["/dashboard(.*)"] });
  return { integration, config: {}, isDev: false, isProd: true };
}

function cookieValue(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  expect(header, `${name} cookie`).toBeDefined();
  return header!.slice(name.length + 1).split(";")[0]!;
}

function withSession(url: string, session: string): Request {
  return new Request(url, { headers: { cookie: `farm_auth0_session=${session}` } });
}

async function login(rt: ReturnType<typeof runtime>) {
  const response = await dispatchIntegrationRequest(
    rt,
    new Request("https://app.example.com/auth/login?returnTo=%2Fdashboard"),
  );
  expect(response!.status).toBe(302);
  const state = new URL(response!.headers.get("location")!).searchParams.get("state")!;
  return { state, stateCookie: cookieValue(response!, "farm_auth0_state") };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth0 signed cookie purposes", () => {
  it("does not accept the anonymous login state cookie as a session", async () => {
    const rt = runtime();
    const { stateCookie } = await login(rt);

    const guarded = await dispatchIntegrationRequest(
      rt,
      withSession("https://app.example.com/dashboard/admin", stateCookie),
    );
    expect(guarded?.status).toBe(303);
    expect(guarded?.headers.get("location")).toContain("/auth/login");

    const profile = await dispatchIntegrationRequest(
      rt,
      withSession("https://app.example.com/auth/profile", stateCookie),
    );
    expect(profile?.status).toBe(401);
  });

  it("rejects session payloads without a numeric expiry and a user object", async () => {
    const rt = runtime();
    const mint = (payload: unknown) => {
      const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      const signature = createHmac("sha256", AUTH0_ENV.secret)
        .update(`farm-auth0:session.${encoded}`)
        .digest("hex");
      return `${encoded}.${signature}`;
    };

    for (const payload of [
      { user: { sub: "user_test" } },
      { user: { sub: "user_test" }, expiresAt: "9999999999999" },
      { expiresAt: Date.now() + 60_000 },
      { user: "user_test", expiresAt: Date.now() + 60_000 },
    ]) {
      const profile = await dispatchIntegrationRequest(
        rt,
        withSession("https://app.example.com/auth/profile", mint(payload)),
      );
      expect(profile?.status, JSON.stringify(payload)).toBe(401);
    }
  });

  it("issues a session from the callback that unlocks protected routes, and never accepts it as state", async () => {
    const rt = runtime();
    const { state, stateCookie } = await login(rt);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/oauth/token")) {
          return Response.json({ access_token: "access", expires_in: 3600 });
        }
        if (url.endsWith("/userinfo")) {
          return Response.json({ sub: "auth0|user", email: "user@example.com" });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const callback = await dispatchIntegrationRequest(
      rt,
      new Request(`https://app.example.com/auth/callback?code=abc&state=${state}`, {
        headers: { cookie: `farm_auth0_state=${stateCookie}` },
      }),
    );
    expect(callback?.status).toBe(302);
    const session = cookieValue(callback!, "farm_auth0_session");

    const guarded = await dispatchIntegrationRequest(
      rt,
      withSession("https://app.example.com/dashboard/admin", session),
    );
    expect(guarded).toBeNull();

    const profile = await dispatchIntegrationRequest(
      rt,
      withSession("https://app.example.com/auth/profile", session),
    );
    expect(await profile?.json()).toMatchObject({
      authenticated: true,
      user: { sub: "auth0|user" },
    });

    const replayedAsState = await dispatchIntegrationRequest(
      rt,
      new Request(`https://app.example.com/auth/callback?code=abc&state=${state}`, {
        headers: { cookie: `farm_auth0_state=${session}` },
      }),
    );
    expect(replayedAsState?.status).toBe(400);
  });
});
