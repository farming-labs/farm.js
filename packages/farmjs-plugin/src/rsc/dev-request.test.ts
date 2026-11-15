import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import farmRsc from "./index.js";
import { linkRscFixtureDependencies } from "./test-fixture-dependencies.js";

async function dispatchRscDevRequest(
  headers: Record<string, string>,
  url = "/dashboard",
  runnable = true,
): Promise<{ status: number; request?: Request; context?: { clientAddress?: string } }> {
  const root = mkdtempSync(path.join(tmpdir(), "farm-dev-rsc-request-"));
  const previousSSRLoader = (globalThis as any).__VITE_RSC_LOAD_SSR__;
  const previousBootstrap = (globalThis as any).__FARM_VITE_RSC_LOAD_BOOTSTRAP__;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    linkRscFixtureDependencies(root);
    const plugins = farmRsc();
    const configure = plugins.find((plugin) => plugin.name === "@farm.js/plugin/rsc:config")!
      .config as Function;
    await configure(
      { root, experimental: { serverComponents: true } },
      { command: "serve", mode: "development" },
    );
    let middleware!: Function;
    const fetch = vi.fn(async (_request: Request, _context?: { clientAddress?: string }) => {
      return new Response("ok");
    });
    const server = {
      config: { root, publicDir: path.join(root, "public") },
      middlewares: {
        use(handler: Function) {
          middleware = handler;
        },
      },
      environments: {
        rsc: {
          pluginContainer: { resolveId: async () => ({ id: "test-entry" }) },
          runner: runnable ? { import: async () => ({ default: { fetch } }) } : undefined,
        },
      },
    };
    const configureServer = plugins.find(
      (plugin) => plugin.name === "@farm.js/plugin/rsc:dev-server",
    )!.configureServer as Function;
    configureServer(server)();
    const request = Object.assign(Readable.from([]), {
      method: "GET",
      url,
      headers,
      socket: { remoteAddress: "203.0.113.7" },
    });
    const response = {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      write: vi.fn(() => true),
      end: vi.fn(),
    };
    await middleware(request, response, vi.fn());
    const call = fetch.mock.calls[0];
    return { status: response.statusCode, request: call?.[0], context: call?.[1] };
  } finally {
    log.mockRestore();
    error.mockRestore();
    if (previousSSRLoader === undefined) delete (globalThis as any).__VITE_RSC_LOAD_SSR__;
    else (globalThis as any).__VITE_RSC_LOAD_SSR__ = previousSSRLoader;
    if (previousBootstrap === undefined)
      delete (globalThis as any).__FARM_VITE_RSC_LOAD_BOOTSTRAP__;
    else (globalThis as any).__FARM_VITE_RSC_LOAD_BOOTSTRAP__ = previousBootstrap;
    rmSync(root, { recursive: true, force: true });
  }
}

it("renders an HTTP/2 request whose headers include pseudo-headers", async () => {
  const result = await dispatchRscDevRequest({
    ":method": "GET",
    ":path": "/dashboard",
    ":scheme": "https",
    ":authority": "farm.test:5173",
    accept: "text/html",
  });

  expect(result.status).toBe(200);
  expect(result.request?.headers.get("host")).toBe("farm.test:5173");
  expect(result.request?.headers.get("accept")).toBe("text/html");
  expect(new URL(result.request!.url).pathname).toBe("/dashboard");
});

it("passes the peer address so the default rate-limit key can resolve", async () => {
  const result = await dispatchRscDevRequest({ host: "farm.test" });

  expect(result.context?.clientAddress).toBe("203.0.113.7");
});

it("keeps the request path when the Host header carries one", async () => {
  const result = await dispatchRscDevRequest({ host: "farm.test/admin#" }, "/dashboard");

  expect(new URL(result.request!.url).pathname).toBe("/dashboard");
});

it("reports a non-runnable RSC environment instead of silently using Node SSR", async () => {
  const result = await dispatchRscDevRequest({ host: "farm.test" }, "/dashboard", false);
  expect(result.status).toBe(500);
  expect(result.request).toBeUndefined();
});
