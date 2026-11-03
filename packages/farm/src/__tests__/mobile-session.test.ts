// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateIntegrationRequestOrigin } from "../integration-request-security";
import { createFarmMobileSessionPlugin, type FarmMobileSessionStore } from "../mobile/session";
import { PluginManager } from "../plugin";
import {
  resolveServerActionsConfig,
  ServerActionRequestError,
  validateServerActionRequest,
} from "../server-action-security";

const ORIGIN = "https://notes.example.com";
const APP = "com.example.notes";

interface Seen {
  cookie: string | null;
  authorization: string | null;
  origin: string | null;
  user: string | null;
  /** Server action origin check: null when it passed, else its error code. */
  action: string | null;
  /** Integration route origin check, as auth routes run it. */
  integration: boolean;
}

/**
 * A plugin runtime with the mobile session plugin, an auth integration whose cookie `sid` names
 * a session, and a downstream app that reports what it saw and runs Farm's origin checks.
 */
function createHarness(options: { reader?: boolean } = {}) {
  let clock = 1_000_000;
  const items = new Map<string, string>();
  const storage: FarmMobileSessionStore = {
    async getItem(key) {
      const value = items.get(key);
      return value === undefined ? null : JSON.parse(value);
    },
    async setItem(key, value) {
      items.set(key, JSON.stringify(value));
    },
    async removeItem(key) {
      items.delete(key);
    },
  };
  /** sid cookie value -> user */
  const sessions = new Map<string, string>([["sid-alice", "alice"]]);
  const sid = (request: Request) =>
    /(?:^|;\s*)sid=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  const integration = {
    kind: "farm-integration",
    category: "auth",
    type: "test-auth",
    instance: {},
    ...(options.reader === false
      ? {}
      : {
          session(request: Request) {
            const id = sid(request);
            const user = id && sessions.get(id);
            return user ? { id: `session:${id}`, userId: user } : null;
          },
        }),
  };
  const plugin = createFarmMobileSessionPlugin({
    integrations: () => ({ auth: integration }),
    storage: () => storage,
    now: () => clock,
  });
  const manager = new PluginManager({ config: {}, isDev: false, isProd: true });
  manager.addPlugin(plugin);
  const seen: Seen[] = [];
  const serverActions = resolveServerActionsConfig({});

  /** What the app answers: `/sign-out` ends the cookie session, `/rotate` rotates `sid`. */
  async function app(request: Request): Promise<Response> {
    let action: string | null = null;
    try {
      validateServerActionRequest(request, serverActions);
    } catch (error) {
      action = error instanceof ServerActionRequestError ? error.code : String(error);
    }
    const id = sid(request);
    seen.push({
      cookie: request.headers.get("cookie"),
      authorization: request.headers.get("authorization"),
      origin: request.headers.get("origin"),
      user: (id && sessions.get(id)) || null,
      action,
      integration: validateIntegrationRequestOrigin(request).ok,
    });
    const path = new URL(request.url).pathname;
    if (path === "/sign-out" && id) {
      sessions.delete(id);
      return new Response("bye", { headers: { "set-cookie": "sid=; Path=/; Max-Age=0" } });
    }
    if (path === "/rotate" && id) {
      const user = sessions.get(id)!;
      sessions.delete(id);
      sessions.set("sid-rotated", user);
      return new Response("rotated", {
        headers: { "set-cookie": "sid=sid-rotated; Path=/; HttpOnly" },
      });
    }
    return Response.json({ user: (id && sessions.get(id)) || null });
  }

  const send = (request: Request) => manager.runRuntimeRequest(request, app);

  function native(
    path: string,
    init: {
      body?: unknown;
      cookie?: string;
      token?: string;
      app?: string | null;
      method?: string;
    } = {},
  ): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (init.app !== null) headers.set("x-farm-mobile", init.app ?? APP);
    if (init.cookie) headers.set("cookie", init.cookie);
    if (init.token) headers.set("authorization", `Bearer ${init.token}`);
    return new Request(`${ORIGIN}${path}`, {
      method: init.method ?? "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  /** The shell's sign-in: challenge, then issue, with the WebView's cookies. */
  async function signIn(cookie = "sid=sid-alice; theme=dark") {
    const challenge = await send(native("/__farm/mobile/session/challenge", { cookie }));
    expect(challenge.status).toBe(200);
    const { nonce } = (await challenge.json()) as { nonce: string };
    const issued = await send(native("/__farm/mobile/session", { cookie, body: { nonce } }));
    expect(issued.status).toBe(200);
    const tokens = (await issued.json()) as { accessToken: string; refreshToken: string };
    return { ...tokens, marker: issued.headers.get("set-cookie") ?? "" };
  }

  return {
    items,
    sessions,
    seen,
    send,
    native,
    signIn,
    advance(ms: number) {
      clock += ms;
    },
  };
}

describe("mobile session tokens", () => {
  it("issues opaque tokens for a signed-in cookie session and stores only hashes and sealed cookies", async () => {
    const harness = createHarness();
    const { accessToken, refreshToken, marker } = await harness.signIn();
    expect(accessToken).toMatch(/^fma1\.[\w-]{22}\.[\w-]{43}\.[\w-]{43}$/);
    expect(refreshToken).toMatch(/^fmr1\.[\w-]{22}\.[\w-]{43}\.[\w-]{43}$/);
    expect(marker).toMatch(
      /^farm_mobile=[\w-]{22}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$/,
    );

    const stored = [...harness.items.values()].join("\n");
    for (const part of [...accessToken.split(".").slice(2), ...refreshToken.split(".").slice(2)]) {
      expect(stored).not.toContain(part);
    }
    expect(stored).not.toContain("sid-alice");
    // The challenge nonce is single use and already gone.
    expect([...harness.items.keys()].filter((key) => key.startsWith("challenge:"))).toEqual([]);
  });

  it("runs a bearer request as the cookie session, same-origin, without the token", async () => {
    const harness = createHarness();
    const { accessToken } = await harness.signIn();
    const response = await harness.send(
      harness.native("/api/notes", { token: accessToken, body: {} }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: "alice" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(harness.seen.at(-1)).toEqual({
      cookie: "sid=sid-alice; theme=dark",
      authorization: null,
      origin: ORIGIN,
      user: "alice",
      // Server functions and integration routes accept it.
      action: null,
      integration: true,
    });
  });

  it("keeps today's origin checks for a native-shaped request without a token", async () => {
    const harness = createHarness();
    await harness.send(harness.native("/api/notes", { cookie: "sid=sid-alice", body: {} }));
    expect(harness.seen.at(-1)).toMatchObject({
      user: "alice",
      action: "MISSING_ORIGIN",
      integration: false,
    });
  });

  it("ignores a bearer, forged or valid, on a request a browser page sent", async () => {
    const harness = createHarness();
    const { accessToken } = await harness.signIn();
    const forged = `fma1.${"A".repeat(22)}.${"B".repeat(43)}.${"C".repeat(43)}`;
    for (const token of [forged, accessToken]) {
      const request = new Request(`${ORIGIN}/api/notes`, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
          authorization: `Bearer ${token}`,
          "x-farm-mobile": APP,
          "content-type": "application/json",
        },
        body: "{}",
      });
      const response = await harness.send(request);
      expect(response.status).toBe(200);
      expect(harness.seen.at(-1)).toEqual({
        cookie: null,
        authorization: `Bearer ${token}`,
        origin: "https://evil.example",
        user: null,
        action: "INVALID_ORIGIN",
        integration: false,
      });
    }
    // Same-origin page script (XSS) holding a token gets nothing from it either.
    const sameOrigin = new Request(`${ORIGIN}/api/notes`, {
      headers: {
        "sec-fetch-site": "same-origin",
        authorization: `Bearer ${accessToken}`,
        "x-farm-mobile": APP,
      },
    });
    await harness.send(sameOrigin);
    expect(harness.seen.at(-1)).toMatchObject({ cookie: null, user: null });
  });

  it("rejects a forged token from a native client", async () => {
    const harness = createHarness();
    const { accessToken } = await harness.signIn();
    const [prefix, device, , key] = accessToken.split(".");
    const forged = `${prefix}.${device}.${"x".repeat(43)}.${key}`;
    const response = await harness.send(harness.native("/api/notes", { token: forged }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect(harness.seen).toHaveLength(0);
  });

  it("rejects a token used against another app id", async () => {
    const harness = createHarness();
    const { accessToken, refreshToken } = await harness.signIn();
    for (const app of ["com.example.other", null]) {
      const response = await harness.send(
        harness.native("/api/notes", { token: accessToken, app }),
      );
      expect(response.status).toBe(401);
    }
    const refresh = await harness.send(
      harness.native("/__farm/mobile/session/refresh", {
        app: "com.example.other",
        body: { refreshToken },
      }),
    );
    expect(refresh.status).toBe(401);
    expect(harness.seen).toHaveLength(0);
    // The device's own app still works.
    expect((await harness.send(harness.native("/api/notes", { token: accessToken }))).status).toBe(
      200,
    );
  });

  it("rejects an expired access token and refreshes into a new pair", async () => {
    const harness = createHarness();
    const first = await harness.signIn();
    harness.advance(15 * 60 * 1000);
    const expired = await harness.send(harness.native("/api/notes", { token: first.accessToken }));
    expect(expired.status).toBe(401);

    const refreshed = await harness.send(
      harness.native("/__farm/mobile/session/refresh", {
        body: { refreshToken: first.refreshToken },
      }),
    );
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { accessToken: string; refreshToken: string };
    expect(next.accessToken).not.toBe(first.accessToken);
    expect(next.refreshToken).not.toBe(first.refreshToken);
    const response = await harness.send(harness.native("/api/notes", { token: next.accessToken }));
    expect(await response.json()).toEqual({ user: "alice" });
  });

  it("revokes the device when a used refresh token is replayed", async () => {
    const harness = createHarness();
    const first = await harness.signIn();
    const rotated = await harness.send(
      harness.native("/__farm/mobile/session/refresh", {
        body: { refreshToken: first.refreshToken },
      }),
    );
    const next = (await rotated.json()) as { accessToken: string; refreshToken: string };

    const replay = await harness.send(
      harness.native("/__farm/mobile/session/refresh", {
        body: { refreshToken: first.refreshToken },
      }),
    );
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: "refresh_reused" });
    // Whoever holds the rotated pair is signed out too.
    expect(
      (await harness.send(harness.native("/api/notes", { token: next.accessToken }))).status,
    ).toBe(401);
    const after = await harness.send(
      harness.native("/__farm/mobile/session/refresh", {
        body: { refreshToken: next.refreshToken },
      }),
    );
    expect(after.status).toBe(401);
  });

  it("rejects an expired refresh token", async () => {
    const harness = createHarness();
    const { refreshToken } = await harness.signIn();
    harness.advance(30 * 24 * 60 * 60 * 1000);
    const response = await harness.send(
      harness.native("/__farm/mobile/session/refresh", { body: { refreshToken } }),
    );
    expect(response.status).toBe(401);
  });

  it("revokes tokens through the revoke endpoint", async () => {
    const harness = createHarness();
    const byAccess = await harness.signIn();
    const revoked = await harness.send(
      harness.native("/__farm/mobile/session/revoke", { token: byAccess.accessToken }),
    );
    expect(revoked.status).toBe(204);
    expect(revoked.headers.get("set-cookie")).toMatch(/^farm_mobile=; Path=\/; Max-Age=0;/);
    expect(
      (await harness.send(harness.native("/api/notes", { token: byAccess.accessToken }))).status,
    ).toBe(401);
    const refresh = await harness.send(
      harness.native("/__farm/mobile/session/refresh", {
        body: { refreshToken: byAccess.refreshToken },
      }),
    );
    expect(refresh.status).toBe(401);

    const byRefresh = await harness.signIn();
    await harness.send(
      harness.native("/__farm/mobile/session/revoke", {
        body: { refreshToken: byRefresh.refreshToken },
      }),
    );
    expect(
      (await harness.send(harness.native("/api/notes", { token: byRefresh.accessToken }))).status,
    ).toBe(401);
  });

  it("revokes the device when the user signs out on a web screen", async () => {
    const harness = createHarness();
    const { accessToken, refreshToken, marker } = await harness.signIn();
    const device = marker.split(";")[0]!;
    // The WebView's sign-out: its cookies plus the device marker the shell stored.
    const response = await harness.send(
      new Request(`${ORIGIN}/sign-out`, {
        method: "POST",
        headers: { origin: ORIGIN, cookie: `sid=sid-alice; ${device}` },
      }),
    );
    expect(response.headers.getSetCookie()).toEqual([
      "sid=; Path=/; Max-Age=0",
      expect.stringMatching(/^farm_mobile=; Path=\/; Max-Age=0;/),
    ]);
    expect((await harness.send(harness.native("/api/notes", { token: accessToken }))).status).toBe(
      401,
    );
    const refresh = await harness.send(
      harness.native("/__farm/mobile/session/refresh", { body: { refreshToken } }),
    );
    expect(refresh.status).toBe(401);
  });

  it("leaves the device alone when a web response clears a cookie but the user stays signed in", async () => {
    const harness = createHarness();
    const { accessToken, marker } = await harness.signIn();
    const response = await harness.send(
      new Request(`${ORIGIN}/rotate`, {
        headers: { cookie: `sid=sid-alice; ${marker.split(";")[0]}` },
      }),
    );
    expect(response.headers.getSetCookie()).toEqual(["sid=sid-rotated; Path=/; HttpOnly"]);
    // The WebView rotated, the device's own cookies did not; its session ended with the old sid.
    expect((await harness.send(harness.native("/api/notes", { token: accessToken }))).status).toBe(
      200,
    );
  });

  it("ends the device when its web session ended by the next refresh", async () => {
    const harness = createHarness();
    const { refreshToken } = await harness.signIn();
    harness.sessions.delete("sid-alice");
    const response = await harness.send(
      harness.native("/__farm/mobile/session/refresh", { body: { refreshToken } }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "signed_out" });
  });

  it("keeps cookie rotations from bearer responses in the device and off the wire", async () => {
    const harness = createHarness();
    const { accessToken } = await harness.signIn();
    const rotated = await harness.send(harness.native("/rotate", { token: accessToken }));
    expect(rotated.headers.get("set-cookie")).toBeNull();
    const response = await harness.send(harness.native("/api/notes", { token: accessToken }));
    expect(await response.json()).toEqual({ user: "alice" });
    expect(harness.seen.at(-1)?.cookie).toBe("sid=sid-rotated; theme=dark");
  });

  it("revokes the device when a bearer request signs out", async () => {
    const harness = createHarness();
    const { accessToken } = await harness.signIn();
    const response = await harness.send(harness.native("/sign-out", { token: accessToken }));
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await harness.send(harness.native("/api/notes", { token: accessToken }))).status).toBe(
      401,
    );
  });

  it("answers the shell only: no browser requests, an app id, and POST", async () => {
    const harness = createHarness();
    const browser = new Request(`${ORIGIN}/__farm/mobile/session/challenge`, {
      method: "POST",
      headers: { origin: ORIGIN, cookie: "sid=sid-alice", "x-farm-mobile": APP },
    });
    expect((await harness.send(browser)).status).toBe(403);
    const fetchMetadata = new Request(`${ORIGIN}/__farm/mobile/session/challenge`, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", cookie: "sid=sid-alice", "x-farm-mobile": APP },
    });
    expect((await harness.send(fetchMetadata)).status).toBe(403);
    const noApp = harness.native("/__farm/mobile/session/challenge", {
      cookie: "sid=sid-alice",
      app: null,
    });
    expect((await harness.send(noApp)).status).toBe(400);
    const badApp = harness.native("/__farm/mobile/session/challenge", {
      cookie: "sid=sid-alice",
      app: "notes",
    });
    expect((await harness.send(badApp)).status).toBe(400);
    const get = harness.native("/__farm/mobile/session/challenge", {
      cookie: "sid=sid-alice",
      method: "GET",
    });
    expect((await harness.send(get)).status).toBe(405);
    expect(harness.seen).toHaveLength(0);
  });

  it("needs a signed-in cookie session and a fresh, single-use nonce", async () => {
    const harness = createHarness();
    const anonymous = await harness.send(harness.native("/__farm/mobile/session/challenge"));
    expect(anonymous.status).toBe(401);
    const signedOut = await harness.send(
      harness.native("/__farm/mobile/session/challenge", { cookie: "sid=unknown" }),
    );
    expect(signedOut.status).toBe(401);

    const cookie = "sid=sid-alice";
    const noChallenge = await harness.send(
      harness.native("/__farm/mobile/session", { cookie, body: { nonce: "x".repeat(43) } }),
    );
    expect(noChallenge.status).toBe(401);

    const challenge = await harness.send(
      harness.native("/__farm/mobile/session/challenge", { cookie }),
    );
    const { nonce } = (await challenge.json()) as { nonce: string };
    const wrong = await harness.send(
      harness.native("/__farm/mobile/session", { cookie, body: { nonce: `${nonce}x` } }),
    );
    expect(wrong.status).toBe(401);
    // A wrong guess used it up.
    const reused = await harness.send(
      harness.native("/__farm/mobile/session", { cookie, body: { nonce } }),
    );
    expect(reused.status).toBe(401);

    const late = await harness.send(harness.native("/__farm/mobile/session/challenge", { cookie }));
    const lateNonce = ((await late.json()) as { nonce: string }).nonce;
    harness.advance(60 * 1000);
    const expired = await harness.send(
      harness.native("/__farm/mobile/session", { cookie, body: { nonce: lateNonce } }),
    );
    expect(expired.status).toBe(401);

    // A nonce issued to one session does not work with another session's cookies.
    harness.sessions.set("sid-bob", "bob");
    const alice = await harness.send(
      harness.native("/__farm/mobile/session/challenge", { cookie }),
    );
    const aliceNonce = ((await alice.json()) as { nonce: string }).nonce;
    const bob = await harness.send(
      harness.native("/__farm/mobile/session", {
        cookie: "sid=sid-bob",
        body: { nonce: aliceNonce },
      }),
    );
    expect(bob.status).toBe(401);
  });

  it("says so when no auth integration reads sessions", async () => {
    const harness = createHarness({ reader: false });
    const response = await harness.send(
      harness.native("/__farm/mobile/session/challenge", { cookie: "sid=sid-alice" }),
    );
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: "mobile_session_unavailable" });
  });

  it("leaves requests without a mobile bearer untouched and cacheable", async () => {
    const harness = createHarness();
    const request = new Request(`${ORIGIN}/`, {
      headers: { authorization: "Bearer app-api-key", cookie: "a=1" },
    });
    const response = await harness.send(request);
    expect(response.headers.get("cache-control")).toBeNull();
    expect(harness.seen.at(-1)).toMatchObject({
      cookie: "a=1",
      authorization: "Bearer app-api-key",
    });
  });
});
