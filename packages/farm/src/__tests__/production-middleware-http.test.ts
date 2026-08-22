// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  applyProductionMiddlewareHeaders,
  createProductionMiddlewareRunner,
} from "../middleware/production-runtime";

describe("production middleware HTTP behavior", () => {
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
