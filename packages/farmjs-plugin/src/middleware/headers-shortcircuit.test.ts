import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import farmMiddleware, { type MiddlewareHandler } from "./index.js";

type AnyServer = Record<string, any> & {
  config: { root: string; publicDir: string };
  hot: undefined;
  middlewares: { use: (fn: any) => void };
  ssrLoadModule: (...args: any[]) => any;
};

// Build a minimal fake Vite dev server, wire the plugin's configureServer
// hook, and wait for middleware discovery to settle. The plugin exposes its
// runner via `server.__farmMiddleware__`; we inject handlers directly into the
// returned cache so the tests do not depend on disk fixtures or ssrLoadModule.
async function setupPlugin(options?: { srcDir?: string }) {
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "farm-mw-headers-"));
  let installedMiddleware: ((req: any, res: any, next: any) => Promise<void>) | undefined;
  const fakeServer: AnyServer = {
    config: { root: tmpRoot, publicDir: path.join(tmpRoot, "public") },
    hot: undefined,
    middlewares: {
      use(fn: any) {
        installedMiddleware = fn;
      },
    },
    ssrLoadModule: vi.fn(),
  };

  const plugin = farmMiddleware(options ?? {});
  const postHook = (plugin as any).configureServer(fakeServer) as () => void;
  await (fakeServer as any).__farmMiddleware__.waitForDiscovery();

  return {
    server: fakeServer,
    execute: (fakeServer as any).__farmMiddleware__.execute as (
      req: IncomingMessage,
      res: ServerResponse,
      pathname: string,
      sharedData?: Map<string, any>,
    ) => Promise<boolean>,
    getCache: () => (fakeServer as any).__farmMiddleware__.getCache() as Map<string, any>,
    install: () => {
      postHook();
      return installedMiddleware!;
    },
    cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

function createMockRequest(urlPath: string, method = "GET"): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.url = urlPath;
  req.method = method;
  req.headers = { host: "localhost:3000" };
  return req;
}

function createMockResponse(): ServerResponse {
  const res = new ServerResponse(createMockRequest("/"));
  (res as any).writeHead = vi.fn().mockReturnValue(res);
  (res as any).end = vi.fn().mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") cb();
    return res;
  });
  (res as any).setHeader = vi.fn();
  return res;
}

function builder(handler: MiddlewareHandler) {
  return {
    setBasePath() {},
    build: () => ({ handlers: [handler] }),
  };
}

describe("plugin middleware: ctx.headers flushed before helper short-circuit", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("applies ctx.headers before json() short-circuit (builder module)", async () => {
    const { execute, getCache, cleanup } = await setupPlugin();
    try {
      const handler: MiddlewareHandler = async (ctx, _next) => {
        ctx.headers.set("x-request-id", "req-123");
        ctx.json({ ok: true });
      };
      getCache().set("/", {
        path: "/",
        filePath: "<test>",
        module: builder(handler),
        config: {},
      });

      const req = createMockRequest("/admin");
      const res = createMockResponse();
      const handled = await execute(req, res, "/admin");

      expect(handled).toBe(true);
      expect(res.setHeader).toHaveBeenCalledWith("x-request-id", "req-123");
      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
    } finally {
      cleanup();
    }
  });

  it("applies ctx.headers before text() short-circuit (builder module)", async () => {
    const { execute, getCache, cleanup } = await setupPlugin();
    try {
      const handler: MiddlewareHandler = async (ctx, _next) => {
        ctx.headers.set("x-trace", "abc");
        ctx.text("hello", 202);
      };
      getCache().set("/", {
        path: "/",
        filePath: "<test>",
        module: builder(handler),
        config: {},
      });

      const req = createMockRequest("/status");
      const res = createMockResponse();
      await execute(req, res, "/status");

      expect(res.setHeader).toHaveBeenCalledWith("x-trace", "abc");
      expect(res.writeHead).toHaveBeenCalledWith(202, { "Content-Type": "text/plain" });
      expect(res.end).toHaveBeenCalledWith("hello");
    } finally {
      cleanup();
    }
  });

  it("applies ctx.headers before html() short-circuit (builder module)", async () => {
    const { execute, getCache, cleanup } = await setupPlugin();
    try {
      const handler: MiddlewareHandler = async (ctx, _next) => {
        ctx.headers.set("content-security-policy", "default-src 'self'");
        ctx.html("<h1>admin</h1>");
      };
      getCache().set("/", {
        path: "/",
        filePath: "<test>",
        module: builder(handler),
        config: {},
      });

      const req = createMockRequest("/admin");
      const res = createMockResponse();
      await execute(req, res, "/admin");

      expect(res.setHeader).toHaveBeenCalledWith("content-security-policy", "default-src 'self'");
      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/html" });
    } finally {
      cleanup();
    }
  });

  it("applies ctx.headers before redirect() short-circuit (builder module)", async () => {
    const { execute, getCache, cleanup } = await setupPlugin();
    try {
      const handler: MiddlewareHandler = async (ctx, _next) => {
        ctx.headers.set("cache-control", "no-store");
        ctx.redirect("/login");
      };
      getCache().set("/", {
        path: "/",
        filePath: "<test>",
        module: builder(handler),
        config: {},
      });

      const req = createMockRequest("/admin");
      const res = createMockResponse();
      await execute(req, res, "/admin");

      expect(res.setHeader).toHaveBeenCalledWith("cache-control", "no-store");
      expect(res.writeHead).toHaveBeenCalledWith(307, {
        Location: "/login",
        "Content-Type": "text/plain",
      });
      expect(res.end).toHaveBeenCalledWith("Redirecting to /login");
    } finally {
      cleanup();
    }
  });

  it("applies ctx.headers before json() short-circuit (plain-function module)", async () => {
    // Plain-function module branch (index.ts:440-443). The fix lives in the
    // shared createContext, so this branch + the builder branch above both
    // exercise it; this test pins the plain-function dispatch as well.
    const { execute, getCache, cleanup } = await setupPlugin();
    try {
      const handler: MiddlewareHandler = async (ctx, _next) => {
        ctx.headers.set("x-request-id", "req-123");
        ctx.json({ ok: true });
      };
      getCache().set("/", {
        path: "/",
        filePath: "<test>",
        module: handler,
        config: {},
      });

      const req = createMockRequest("/api/data");
      const res = createMockResponse();
      const handled = await execute(req, res, "/api/data");

      expect(handled).toBe(true);
      expect(res.setHeader).toHaveBeenCalledWith("x-request-id", "req-123");
      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
    } finally {
      cleanup();
    }
  });

  it("applies ctx.headers through the installed dev-server middleware function", async () => {
    const { install, getCache, cleanup } = await setupPlugin();
    try {
      const handler: MiddlewareHandler = async (ctx, _next) => {
        ctx.headers.set("content-security-policy", "default-src 'self'");
        ctx.html("<h1>admin</h1>");
      };
      getCache().set("/", {
        path: "/",
        filePath: "<test>",
        module: builder(handler),
        config: {},
      });
      const installed = install();

      const req = createMockRequest("/admin");
      const res = createMockResponse();
      await installed(req, res, () => {});

      expect(res.setHeader).toHaveBeenCalledWith("content-security-policy", "default-src 'self'");
      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/html" });
    } finally {
      cleanup();
    }
  });

  it("still flushes ctx.headers via the runner tail when not short-circuiting", async () => {
    const { execute, getCache, cleanup } = await setupPlugin();
    try {
      const handler: MiddlewareHandler = async (ctx, next) => {
        ctx.headers.set("x-request-id", "req-123");
        await next();
      };
      getCache().set("/", {
        path: "/",
        filePath: "<test>",
        module: builder(handler),
        config: {},
      });

      const req = createMockRequest("/page");
      const res = createMockResponse();
      const handled = await execute(req, res, "/page");

      // No helper short-circuit -> runner reaches its tail flush and returns false.
      expect(handled).toBe(false);
      expect(res.setHeader).toHaveBeenCalledWith("x-request-id", "req-123");
    } finally {
      cleanup();
    }
  });

  it("drops only the invalid header and still sends the response", async () => {
    const { execute, getCache, cleanup } = await setupPlugin();
    try {
      const handler: MiddlewareHandler = async (ctx, _next) => {
        ctx.headers.set("x-valid", "ok");
        ctx.headers.set("x-bad", "will-throw");
        ctx.json({ ok: true });
      };
      getCache().set("/", {
        path: "/",
        filePath: "<test>",
        module: builder(handler),
        config: {},
      });

      const req = createMockRequest("/api/data");
      const res = createMockResponse();
      (res.setHeader as any).mockImplementation((name: string, _value: string) => {
        if (name === "x-bad") throw new Error("invalid header name");
        return res;
      });

      await expect(execute(req, res, "/api/data")).resolves.toBe(true);
      expect(res.setHeader).toHaveBeenCalledWith("x-valid", "ok");
      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
      expect(res.end).toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});
