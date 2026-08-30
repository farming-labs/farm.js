// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  applyProductionMiddlewareHeaders,
  createProductionMiddlewareRunner,
} from "../middleware/production-runtime";

describe("production middleware HTTP behavior", () => {
  it("preserves Max-Age=0 when expiring a cookie", async () => {
    const runner = createProductionMiddlewareRunner({
      config: {
        handler(ctx) {
          ctx.cookies.set("preview", "", { maxAge: 0 });
        },
      },
    });

    const result = await runner(new Request("https://example.com/"));
    expect(result.headers.getSetCookie()).toEqual(["preview=; Max-Age=0; Path=/"]);
  });

  it("keeps multiple middleware cookies as separate Set-Cookie headers", async () => {
    const runner = createProductionMiddlewareRunner({
      config: {
        handler(ctx) {
          ctx.cookies.set("session", "abc", { httpOnly: true });
          ctx.cookies.set("theme", "dark", { sameSite: "lax" });
        },
      },
    });

    const result = await runner(new Request("https://example.com/"));
    expect(result.headers.getSetCookie()).toEqual([
      "session=abc; Path=/; HttpOnly",
      "theme=dark; Path=/; SameSite=Lax",
    ]);

    const response = applyProductionMiddlewareHeaders(
      new Response("ok", { headers: { "set-cookie": "existing=1; Path=/" } }),
      result.headers,
    );
    expect(response.headers.getSetCookie()).toEqual([
      "existing=1; Path=/",
      "session=abc; Path=/; HttpOnly",
      "theme=dark; Path=/; SameSite=Lax",
    ]);
  });

  it("serves requests with malformed percent-encoded paths instead of throwing", async () => {
    const seen: Array<Record<string, string>> = [];
    const runner = createProductionMiddlewareRunner({
      config: {
        matcher: ["/dashboard/:slug"],
        handler(ctx) {
          seen.push({ ...(ctx.params ?? {}) });
        },
      },
    });

    // decodeURIComponent throws on these segments. Matching runs before any
    // handler, so a throw here fails the request rather than 404ing it.
    await expect(
      runner(new Request("https://example.com/dashboard/caf%E9")),
    ).resolves.toBeDefined();
    await expect(runner(new Request("https://example.com/dashboard/%ZZ"))).resolves.toBeDefined();

    // The raw segment is kept as the param value.
    const ok = await runner(new Request("https://example.com/dashboard/ok"));
    expect(ok).toBeDefined();
    expect(seen).toEqual([{ slug: "caf%E9" }, { slug: "%ZZ" }, { slug: "ok" }]);
  });

  it("keeps raw values for malformed segments under a catch-all matcher", async () => {
    const seen: Array<Record<string, string>> = [];
    const runner = createProductionMiddlewareRunner({
      config: {
        matcher: ["/files/:path*"],
        handler(ctx) {
          seen.push({ ...(ctx.params ?? {}) });
        },
      },
    });

    await expect(
      runner(new Request("https://example.com/files/docs/caf%E9/%ZZ")),
    ).resolves.toBeDefined();
    expect(seen).toHaveLength(1);
  });

  it("serves requests with malformed percent-encoded cookies instead of throwing", async () => {
    const seen: Record<string, string | undefined> = {};
    const runner = createProductionMiddlewareRunner({
      config: {
        handler(ctx) {
          seen.track = ctx.cookies.get("track");
          seen.session = ctx.cookies.get("session");
        },
      },
    });

    const result = await runner(
      new Request("https://example.com/", {
        headers: { cookie: "track=100%; session=abc123" },
      }),
    );

    expect(result.response).toBeNull();
    expect(seen).toEqual({ track: "100%", session: "abc123" });
  });

  it("preserves empty request cookies without inherited record values", async () => {
    const seen: Record<string, string | undefined> = {};
    const runner = createProductionMiddlewareRunner({
      config: {
        handler(ctx) {
          seen.preview = ctx.cookies.get("preview");
          seen.constructor = ctx.cookies.get("constructor");
        },
      },
    });

    await runner(
      new Request("https://example.com/", {
        headers: { cookie: "preview=" },
      }),
    );

    expect(seen).toEqual({ preview: "", constructor: undefined });
  });

  it("ignores forwarded client addresses unless trustProxy is enabled", async () => {
    const createRunner = (trustProxy: boolean) =>
      createProductionMiddlewareRunner({
        server: { trustProxy },
        config: {
          handler(ctx) {
            ctx.headers.set("x-client-address", ctx.request.socket.remoteAddress || "missing");
          },
        },
      });
    const request = () =>
      new Request("https://example.com/", {
        headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" },
      });

    const direct = await createRunner(false)(request());
    expect(direct.headers.get("x-client-address")).toBe("127.0.0.1");

    const proxied = await createRunner(true)(request());
    expect(proxied.headers.get("x-client-address")).toBe("203.0.113.8");
  });
});
