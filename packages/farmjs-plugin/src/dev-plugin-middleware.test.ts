import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import farmApi from "./api/index.js";
import farmMiddleware, { type MiddlewareHandler } from "./middleware/index.js";

/**
 * The plain-Vite setup installs farmMiddleware() and farmApi() on one dev
 * server. Both register request handlers after Vite's own, so their order is
 * the order they appear in vite.config. Middleware must run once per request
 * in either order, must see a rewrite honored by the API dispatch, and must
 * fail the request when it throws, as core's dev server does.
 */

type Handler = (req: any, res: any, next: (error?: unknown) => void) => unknown;

const ROUTE_DIR = path.join("src", "api", "users", "[id]");

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "farm-dev-plugins-"));
  mkdirSync(path.join(root, ROUTE_DIR), { recursive: true });
  writeFileSync(path.join(root, ROUTE_DIR, "route.ts"), "export const GET = () => {};");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

async function setup(order: "middleware-first" | "api-first", handler: MiddlewareHandler) {
  const endpoint = vi.fn(async (request: Request) =>
    Response.json({ path: new URL(request.url).pathname }),
  );
  const handlers: Handler[] = [];
  const server: Record<string, any> = {
    config: { root, publicDir: path.join(root, "public") },
    hot: undefined,
    middlewares: { use: (fn: Handler) => handlers.push(fn) },
    ssrLoadModule: vi.fn(async (file: string) =>
      file === path.join(root, ROUTE_DIR, "route.ts") ? { GET: endpoint } : {},
    ),
    moduleGraph: { invalidateModule: vi.fn() },
  };

  const middlewarePlugin = farmMiddleware({ srcDir: "src" }) as any;
  const apiPlugin = farmApi({ srcDir: "src" }) as any;
  const middlewarePost = middlewarePlugin.configureServer(server) as () => void;
  const apiPost = apiPlugin.configureServer(server) as () => void;
  await server.__farmMiddleware__.waitForDiscovery();
  await server.__farmApi__.waitForDiscovery();

  server.__farmMiddleware__.getCache().set("/", {
    path: "/",
    filePath: "<test>",
    module: { setBasePath() {}, build: () => ({ handlers: [handler] }) },
    config: {},
  });

  if (order === "middleware-first") {
    middlewarePost();
    apiPost();
  } else {
    apiPost();
    middlewarePost();
  }

  async function request(url: string) {
    const req = Object.assign(Readable.from([Buffer.alloc(0)]), {
      method: "GET",
      url,
      headers: { host: "localhost:5173" },
    });
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      removeHeader: vi.fn(),
      writeHead: vi.fn(),
      write: vi.fn(() => true),
      end: vi.fn(function (this: any) {
        this.writableEnded = true;
      }),
    });
    let reachedEnd = false;
    let error: unknown;
    let index = 0;
    const next = async (nextError?: unknown): Promise<void> => {
      if (nextError !== undefined) {
        error = nextError;
        return;
      }
      const current = handlers[index++];
      if (!current) {
        reachedEnd = true;
        return;
      }
      await current(req, res, next);
    };
    await next();
    await vi.waitFor(() =>
      expect(res.writableEnded || reachedEnd || error !== undefined).toBe(true),
    );
    return { res, reachedEnd, error };
  }

  return { request, endpoint };
}

describe("farmMiddleware() with farmApi() on one dev server", () => {
  for (const order of ["middleware-first", "api-first"] as const) {
    it(`runs middleware once per API request (${order})`, async () => {
      const calls: string[] = [];
      const { request, endpoint } = await setup(order, async (ctx, next) => {
        calls.push(ctx.pathname);
        await next();
      });

      await request("/api/users/1");

      expect(calls).toEqual(["/api/users/1"]);
      expect(endpoint).toHaveBeenCalledTimes(1);
    });
  }

  for (const order of ["middleware-first", "api-first"] as const) {
    it(`dispatches an API request to the route a middleware rewrote it to (${order})`, async () => {
      const { request, endpoint } = await setup(order, async (ctx, next) => {
        if (ctx.pathname === "/api/users/1") ctx.rewrite("/api/users/2");
        await next();
      });

      await request("/api/users/1");

      expect(endpoint).toHaveBeenCalledTimes(1);
      const dispatched = endpoint.mock.calls[0]![0] as Request;
      expect(new URL(dispatched.url).pathname).toBe("/api/users/2");
    });
  }

  it("fails a page request whose middleware throws instead of rendering it", async () => {
    const { request } = await setup("middleware-first", async () => {
      throw new Error("auth backend down");
    });

    const result = await request("/dashboard");

    expect(result.reachedEnd).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe("auth backend down");
  });
});
