import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import farmApi from "./index.js";

type Endpoint = (request: Request, context?: unknown) => Promise<Response> | Response;

const ROUTE_DIR = path.join("src", "api", "users", "[id]");
const ROUTE_FILE = path.join(ROUTE_DIR, "route.ts");

async function createHarness(
  root: string,
  endpointModule: Record<string, Endpoint>,
): Promise<(req: any, res: any, next: any) => Promise<void>> {
  mkdirSync(path.join(root, ROUTE_DIR), { recursive: true });
  writeFileSync(path.join(root, ROUTE_FILE), "export const GET = () => new Response('ok');");

  let middleware!: (req: any, res: any, next: any) => Promise<void>;
  const server = {
    config: { root, publicDir: path.join(root, "public") },
    middlewares: {
      use(handler: (req: any, res: any, next: any) => Promise<void>) {
        middleware = handler;
      },
    },
    ssrLoadModule: vi.fn(async (filePath: string) =>
      filePath === path.join(root, ROUTE_FILE) ? endpointModule : {},
    ),
    moduleGraph: { invalidateModule: vi.fn() },
  };

  const plugin = farmApi({ srcDir: "src" });
  const setup = plugin.configureServer!(server as any) as () => void;
  setup();
  await (server as any).__farmApi__.waitForDiscovery();
  return middleware;
}

function makeRequest(url: string, method = "GET") {
  return Object.assign(Readable.from([Buffer.alloc(0)]), {
    method,
    url,
    headers: { host: "farm.test" },
  });
}

function makeResponse() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableEnded: false,
    destroyed: false,
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn(),
  });
}

async function withTempRoot(action: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "farm-api-dynamic-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await action(root);
  } finally {
    log.mockRestore();
    errorSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
}

it("serves a dynamic [param] API route in dev, the way production does", async () => {
  await withTempRoot(async (root) => {
    // A dynamic route registers under the literal "/api/users/[id]", so an
    // exact-pathname lookup 404s every real request while the production entry
    // matches it through core's matcher and fills in params.
    const endpoint = vi.fn(async () => new Response("ok"));
    const middleware = await createHarness(root, { GET: endpoint });

    const res = makeResponse();
    await middleware(makeRequest("/api/users/123"), res, vi.fn());

    expect(res.statusCode).not.toBe(404);
    expect(endpoint).toHaveBeenCalledTimes(1);
  });
});

it("answers an unsupported method with 405 and an Allow header", async () => {
  await withTempRoot(async (root) => {
    const middleware = await createHarness(root, { GET: async () => new Response("ok") });

    const res = makeResponse();
    await middleware(makeRequest("/api/users/123", "DELETE"), res, vi.fn());

    expect(res.statusCode).toBe(405);
    const allow = res.setHeader.mock.calls.find(
      ([name]: [string]) => String(name).toLowerCase() === "allow",
    );
    expect(allow?.[1]).toContain("GET");
  });
});

it("still 404s a path that matches no route", async () => {
  await withTempRoot(async (root) => {
    const endpoint = vi.fn(async () => new Response("ok"));
    const middleware = await createHarness(root, { GET: endpoint });

    const res = makeResponse();
    await middleware(makeRequest("/api/orders/123"), res, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(endpoint).not.toHaveBeenCalled();
  });
});
