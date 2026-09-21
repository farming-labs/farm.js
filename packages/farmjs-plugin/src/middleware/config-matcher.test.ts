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

async function setupPlugin() {
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "farm-mw-matcher-"));
  const fakeServer: AnyServer = {
    config: { root: tmpRoot, publicDir: path.join(tmpRoot, "public") },
    hot: undefined,
    middlewares: { use() {} },
    ssrLoadModule: vi.fn(),
  };

  const plugin = farmMiddleware({});
  (plugin as any).configureServer(fakeServer);
  await (fakeServer as any).__farmMiddleware__.waitForDiscovery();

  return {
    execute: (fakeServer as any).__farmMiddleware__.execute as (
      req: IncomingMessage,
      res: ServerResponse,
      pathname: string,
    ) => Promise<boolean>,
    getCache: () => (fakeServer as any).__farmMiddleware__.getCache() as Map<string, any>,
    cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

function createMockRequest(urlPath: string): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.url = urlPath;
  req.method = "GET";
  req.headers = { host: "localhost:3000" };
  return req;
}

function createMockResponse(): ServerResponse {
  const res = new ServerResponse(createMockRequest("/"));
  (res as any).writeHead = vi.fn().mockReturnValue(res);
  (res as any).end = vi.fn().mockReturnValue(res);
  (res as any).setHeader = vi.fn();
  return res;
}

/**
 * A root middleware that narrows itself with `export const config`. In the
 * production runner the matcher decides whether it runs; dev used to consult
 * only the directory path, so a scoped auth gate ran on every request.
 */
async function runWith(config: unknown, pathname: string) {
  const { execute, getCache, cleanup } = await setupPlugin();
  try {
    const handler = vi.fn<MiddlewareHandler>(async (_ctx, next) => {
      await next();
    });
    getCache().set("/", {
      path: "/",
      filePath: "<test>",
      module: handler,
      config,
    });

    await execute(createMockRequest(pathname), createMockResponse(), pathname);
    return handler.mock.calls.length;
  } finally {
    cleanup();
  }
}

describe("plugin middleware honors export const config", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("skips a path outside the configured matcher", async () => {
    expect(await runWith({ matcher: ["/dashboard/:path*"] }, "/other")).toBe(0);
  });

  it("runs a path inside the configured matcher", async () => {
    expect(await runWith({ matcher: ["/dashboard/:path*"] }, "/dashboard/settings")).toBe(1);
  });

  it("honors exclude", async () => {
    expect(await runWith({ exclude: ["/public/(.*)"] }, "/public/logo.png")).toBe(0);
    expect(await runWith({ exclude: ["/public/(.*)"] }, "/account")).toBe(1);
  });

  it("still runs everywhere when no matcher is configured", async () => {
    expect(await runWith({}, "/anything")).toBe(1);
    expect(await runWith(undefined, "/anything")).toBe(1);
  });
});
