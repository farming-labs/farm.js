import { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { middleware, type MiddlewareContext } from "@farm.js/core/middleware";
import { describe, expect, it, vi } from "vitest";
import farmMiddleware from "./index.js";

/**
 * A `.when()` condition or function matcher written against `ctx.pathname`, the
 * raw request path, let `/%61dmin/1` past a check for `/admin` while the router
 * served `/admin/1`. Core evaluates them against the route pathname too (#2277),
 * which needs `ctx.routePathname` on the plugin's own context.
 */
async function setup(base = "/") {
  const root = mkdtempSync(path.join(tmpdir(), "farm-mw-route-path-"));
  let handle: ((req: any, res: any, next: (error?: unknown) => void) => unknown) | undefined;
  const server = {
    config: { root, publicDir: path.join(root, "public"), base },
    hot: undefined,
    middlewares: { use: (fn: any) => (handle = fn) },
    environments: { ssr: { runner: { import: vi.fn() } } },
  } as any;
  const register = (farmMiddleware({}) as any).configureServer(server);
  await server.__farmMiddleware__.waitForDiscovery();
  register();

  const seen: Array<{ pathname: string; routePathname: string }> = [];
  const guard = middleware().when(
    (ctx) => ctx.pathname.startsWith("/admin"),
    // Two parameters: a one-parameter callback builds a nested chain instead.
    async (ctx: MiddlewareContext, _next: unknown) => {
      seen.push({ pathname: ctx.pathname, routePathname: ctx.routePathname });
      ctx.json({ error: "unauthorized" }, 401);
    },
  );
  server.__farmMiddleware__.getCache().set("/", { path: "/", filePath: "<test>", module: guard });
  const fnMatcher = vi.fn(async (_ctx: unknown, next: () => Promise<void>) => next());
  server.__farmMiddleware__.getCache().set("/fn", {
    path: "/",
    filePath: "<fn-test>",
    module: fnMatcher,
    config: { matcher: (ctx: MiddlewareContext) => ctx.pathname.startsWith("/reports") },
  });

  const request = async (url: string, originalUrl?: string) => {
    const req = new IncomingMessage(new Socket());
    req.url = url;
    if (originalUrl) (req as any).originalUrl = originalUrl;
    req.method = "GET";
    req.headers = { host: "localhost:5173", accept: "text/html" };
    const res = new ServerResponse(req);
    let status = 0;
    (res as any).writeHead = vi.fn((code: number) => {
      status = code;
      return res;
    });
    (res as any).end = vi.fn(() => res);
    (res as any).setHeader = vi.fn();
    const next = vi.fn();
    await handle!(req, res, next);
    return { status, passedThrough: next.mock.calls.length > 0 };
  };

  return {
    request,
    seen,
    fnMatcher,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("farmMiddleware route pathname", () => {
  it("runs a .when() guard for an encoded path", async () => {
    const app = await setup();
    try {
      for (const url of ["/admin/1", "/%61dmin/1", "/%61dmin"]) {
        expect({ url, ...(await app.request(url)) }).toEqual({
          url,
          status: 401,
          passedThrough: false,
        });
      }
      expect(app.seen.at(1)).toEqual({ pathname: "/%61dmin/1", routePathname: "/admin/1" });
      expect(await app.request("/other")).toEqual({ status: 0, passedThrough: true });
    } finally {
      app.cleanup();
    }
  });

  it("runs a function matcher for an encoded path", async () => {
    const app = await setup();
    try {
      await app.request("/%72eports/q3");
      await app.request("/other");
      expect(app.fnMatcher).toHaveBeenCalledTimes(1);
    } finally {
      app.cleanup();
    }
  });

  it("guards the app path under a Vite base", async () => {
    const app = await setup("/console/");
    try {
      // Vite's HTML fallback rewrote the URL; the guard sees the requested path without the base.
      for (const original of ["/console/admin/1", "/console/%61dmin/1"]) {
        expect(await app.request("/index.html", original)).toEqual({
          status: 401,
          passedThrough: false,
        });
      }
      expect(app.seen.map((entry) => entry.routePathname)).toEqual(["/admin/1", "/admin/1"]);
    } finally {
      app.cleanup();
    }
  });
});
