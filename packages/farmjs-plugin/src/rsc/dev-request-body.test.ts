import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import farmRsc from "./index.js";

const scenarios = [
  ...["POST", "PUT", "PATCH", "DELETE", "QUERY", "GET", "HEAD"].map((method) => ({
    name: method,
    method,
  })),
  { name: "binary", method: "PUT", payload: Buffer.from([0, 255, 240, 128, 10]) },
  {
    name: "multipart",
    method: "PATCH",
    payload: Buffer.from(
      '--test\r\nContent-Disposition: form-data; name="name"\r\n\r\n🍀\r\n--test--\r\n',
    ),
    contentType: "multipart/form-data; boundary=test",
  },
  { name: "chunked limit", method: "PUT", limit: 2, status: 413 },
  {
    name: "declared limit",
    method: "PUT",
    limit: 2,
    headers: { "content-length": "30" },
    status: 413,
  },
  {
    name: "invalid length",
    method: "QUERY",
    headers: { "content-length": "invalid" },
    status: 400,
  },
  {
    name: "action limit",
    method: "POST",
    url: "/form",
    actionLimit: 2,
    headers: { origin: "http://farm.test" },
    status: 413,
  },
  {
    name: "untrusted action",
    method: "POST",
    url: "/form",
    headers: { origin: "https://untrusted.test" },
    status: 403,
  },
  { name: "API is not an action", method: "POST", actionLimit: 2 },
  {
    name: "accepted action",
    method: "POST",
    url: "/form",
    headers: { origin: "http://farm.test" },
  },
];

it.each(scenarios)("preserves bytes and enforces policy: $name", async (scenario) => {
  const {
    method,
    payload = Buffer.from(JSON.stringify({ message: "keep 🍀" })),
    contentType = "application/json",
    limit = 1000,
    actionLimit = 1000,
    headers = {},
    status = 200,
    url = "/backend/echo",
  } = scenario as {
    method: string;
    payload?: Buffer;
    contentType?: string;
    limit?: number;
    actionLimit?: number;
    headers?: Record<string, string>;
    status?: number;
    url?: string;
  };
  const expectedBody = method === "GET" || method === "HEAD" ? Buffer.alloc(0) : payload;
  const root = mkdtempSync(path.join(tmpdir(), "farm-dev-body-"));
  const previousSSRLoader = (globalThis as any).__VITE_RSC_LOAD_SSR__;
  const previousBootstrap = (globalThis as any).__FARM_VITE_RSC_LOAD_BOOTSTRAP__;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const plugins = farmRsc();
    const configure = plugins.find((plugin) => plugin.name === "@farm.js/plugin/rsc:config")!
      .config as Function;
    await configure(
      {
        root,
        api: { basePath: "/backend" },
        server: { bodySizeLimit: limit },
        serverActions: { bodySizeLimit: actionLimit },
        experimental: { serverComponents: true, serverActions: true },
      },
      { command: "serve", mode: "development" },
    );
    let middleware!: Function;
    let receivedBody: Buffer | undefined;
    const fetch = vi.fn(async (request: Request) => {
      receivedBody = Buffer.from(await request.arrayBuffer());
      if (method === "GET" || method === "HEAD") expect(request.body).toBeNull();
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
          runner: { import: async () => ({ default: { fetch } }) },
        },
      },
    };
    const configureServer = plugins.find(
      (plugin) => plugin.name === "@farm.js/plugin/rsc:dev-server",
    )!.configureServer as Function;
    configureServer(server)();
    const request = Object.assign(
      Readable.from([expectedBody.subarray(0, 1), expectedBody.subarray(1)]),
      {
        method,
        url,
        headers: { host: "farm.test", "content-type": contentType, ...headers },
      },
    );
    const response = {
      statusCode: 200,
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      write: vi.fn(() => true),
      end: vi.fn(),
    };
    await middleware(request, response, vi.fn());
    expect(response.statusCode).toBe(status);
    if (status === 200) {
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(receivedBody).toEqual(expectedBody);
    } else {
      expect(fetch).not.toHaveBeenCalled();
      expect(response.setHeader).toHaveBeenCalledWith("cache-control", "no-store");
    }
    expect(request.listenerCount("data")).toBe(0);
    expect(request.listenerCount("end")).toBe(0);
  } finally {
    log.mockRestore();
    if (previousSSRLoader === undefined) delete (globalThis as any).__VITE_RSC_LOAD_SSR__;
    else (globalThis as any).__VITE_RSC_LOAD_SSR__ = previousSSRLoader;
    if (previousBootstrap === undefined)
      delete (globalThis as any).__FARM_VITE_RSC_LOAD_BOOTSTRAP__;
    else (globalThis as any).__FARM_VITE_RSC_LOAD_BOOTSTRAP__ = previousBootstrap;
    rmSync(root, { recursive: true, force: true });
  }
});
