// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createFarmDesktopGuard,
  FARM_DESKTOP_COOKIE,
  FARM_DESKTOP_HANDSHAKE_PATH,
  type FarmDesktopGuardOptions,
} from "../desktop/guard";

const SECRET = "s".repeat(43);
const TOKEN = "t".repeat(43);
const PORT = 51234;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function guardWith(options: Partial<FarmDesktopGuardOptions> = {}) {
  return createFarmDesktopGuard({
    secret: SECRET,
    handshakeToken: TOKEN,
    port: () => PORT,
    ...options,
  });
}

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: init.method,
    headers: { host: `127.0.0.1:${PORT}`, ...init.headers },
  });
}

const cookie = { cookie: `${FARM_DESKTOP_COOKIE}=${SECRET}` };

async function reason(response: Response | undefined): Promise<string | undefined> {
  if (!response) return undefined;
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return (await response.text()).trim();
}

describe("desktop guard", () => {
  it("swaps the one-time handshake token for an HttpOnly SameSite=Strict cookie", async () => {
    const guard = guardWith();
    const response = guard(request(`${FARM_DESKTOP_HANDSHAKE_PATH}?t=${TOKEN}`));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/");
    expect(response?.headers.get("set-cookie")).toBe(
      `${FARM_DESKTOP_COOKIE}=${SECRET}; Path=/; HttpOnly; SameSite=Strict`,
    );
    expect(response?.headers.get("referrer-policy")).toBe("no-referrer");

    // The token works once.
    expect(await reason(guard(request(`${FARM_DESKTOP_HANDSHAKE_PATH}?t=${TOKEN}`)))).toContain(
      "used handshake token",
    );
  });

  it("rejects a wrong token without consuming the real one", async () => {
    const guard = guardWith();
    expect(await reason(guard(request(`${FARM_DESKTOP_HANDSHAKE_PATH}?t=${"x".repeat(43)}`)))).toContain(
      "handshake token",
    );
    expect(await reason(guard(request(FARM_DESKTOP_HANDSHAKE_PATH)))).toContain("handshake token");
    // HEAD and POST never consume it either.
    expect(
      await reason(guard(request(`${FARM_DESKTOP_HANDSHAKE_PATH}?t=${TOKEN}`, { method: "HEAD" }))),
    ).toContain("GET");
    expect(guard(request(`${FARM_DESKTOP_HANDSHAKE_PATH}?t=${TOKEN}`))?.status).toBe(303);
  });

  it("puts the handshake under basePath and redirects to the app's home", () => {
    const guard = guardWith({ basePath: "/notes/" });
    expect(guard(request(`${FARM_DESKTOP_HANDSHAKE_PATH}?t=${TOKEN}`))?.status).toBe(403);
    const response = guard(request(`/notes${FARM_DESKTOP_HANDSHAKE_PATH}?t=${TOKEN}`));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/notes/");
  });

  it("answers only requests that carry the session cookie", async () => {
    const guard = guardWith();
    expect(await reason(guard(request("/")))).toContain("own desktop window");
    expect(await reason(guard(request("/api/notes", { headers: { cookie: "farm_desktop=forged" } })))).toBeDefined();
    expect(
      await reason(
        guard(request("/", { headers: { cookie: `${FARM_DESKTOP_COOKIE}=${SECRET}x` } })),
      ),
    ).toBeDefined();
    expect(guard(request("/", { headers: cookie }))).toBeUndefined();
    expect(guard(request("/_build/chunk.js", { headers: cookie }))).toBeUndefined();
    // Another app on 127.0.0.1 can add a cookie with the same name; the real one still counts.
    expect(
      guard(request("/", { headers: { cookie: `farm_desktop=other; ${cookie.cookie}` } })),
    ).toBeUndefined();
  });

  it("rejects foreign hosts, LAN addresses, and other ports (DNS rebinding)", async () => {
    const guard = guardWith();
    for (const host of [
      `evil.example:${PORT}`,
      `192.168.1.20:${PORT}`,
      `127.0.0.1:${PORT + 1}`,
      "127.0.0.1",
      `127.0.0.1.evil.example:${PORT}`,
      "",
    ]) {
      expect(await reason(guard(request("/", { headers: { ...cookie, host } }))), host).toContain(
        "unexpected host",
      );
    }
    for (const host of [`localhost:${PORT}`, `[::1]:${PORT}`, `LOCALHOST:${PORT}`]) {
      expect(guard(request("/", { headers: { ...cookie, host } })), host).toBeUndefined();
    }
  });

  it("refuses everything until the server knows its port", async () => {
    const guard = guardWith({ port: () => undefined });
    expect(await reason(guard(request("/", { headers: cookie })))).toContain("unexpected host");
  });

  it("rejects cross-site and same-site requests, which carry the cookie across ports", async () => {
    const guard = guardWith();
    for (const site of ["cross-site", "same-site"]) {
      expect(
        await reason(guard(request("/", { headers: { ...cookie, "sec-fetch-site": site } }))),
      ).toContain("cross-site");
    }
    for (const site of ["same-origin", "none"]) {
      expect(guard(request("/", { headers: { ...cookie, "sec-fetch-site": site } }))).toBeUndefined();
    }
  });

  it("requires the server's own Origin on unsafe methods", async () => {
    const guard = guardWith();
    const post = (origin: string) =>
      guard(request("/api/notes", { method: "POST", headers: { ...cookie, origin } }));
    expect(await reason(post("http://localhost:3000"))).toContain("cross-origin");
    expect(await reason(post("null"))).toContain("cross-origin");
    expect(post(ORIGIN)).toBeUndefined();
    // A GET with a foreign Origin is a CORS read the browser keeps from the page anyway.
    expect(
      guard(request("/", { headers: { ...cookie, origin: "http://localhost:3000" } })),
    ).toBeUndefined();
  });

  it("accepts a request target without a scheme, as Node's IncomingMessage gives it", () => {
    const guard = guardWith();
    const headers = new Headers({ host: `localhost:${PORT}` });
    const response = guard({
      method: "GET",
      url: `${FARM_DESKTOP_HANDSHAKE_PATH}?t=${TOKEN}`,
      headers,
    });
    expect(response?.status).toBe(303);
  });

  it("refuses weak or reused secrets", () => {
    expect(() => guardWith({ secret: "short" })).toThrow(/at least 32/);
    expect(() => guardWith({ handshakeToken: "t".repeat(20) })).toThrow(/at least 32/);
    expect(() => guardWith({ secret: `${"a".repeat(40)};x` })).toThrow(/base64url/);
    expect(() => guardWith({ handshakeToken: SECRET })).toThrow(/different/);
  });
});
