// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { farmApiPlugin } from "../api/vite-plugin";

const tempDirs = new Set<string>();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
});

function createNodeRequest(url: string, method = "GET"): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.url = url;
  req.method = method;
  req.headers = { host: "localhost:3000" };
  return req;
}

function createNodeResponse() {
  const res = new ServerResponse(createNodeRequest("/"));
  const chunks: string[] = [];
  let ended = false;
  Object.defineProperty(res, "writableEnded", { get: () => ended, configurable: true });
  res.setHeader = vi.fn();
  res.end = vi.fn().mockImplementation((chunk?: unknown) => {
    if (typeof chunk === "string") chunks.push(chunk);
    ended = true;
    return res;
  }) as typeof res.end;
  res.destroy = vi.fn().mockReturnValue(res);
  return { res, chunks };
}

function createFullResponse() {
  const chunks: string[] = [];
  let ended = false;
  let headersSent = false;
  const res: any = {
    statusCode: 200,
    get headersSent() {
      return headersSent;
    },
    get writableEnded() {
      return ended;
    },
    setHeader() {},
    getHeader() {
      return undefined;
    },
    writeHead(status: number) {
      res.statusCode = status;
      headersSent = true;
      return res;
    },
    write(chunk: unknown) {
      if (typeof chunk === "string") chunks.push(chunk);
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk).toString("utf8"));
      return true;
    },
    end(chunk?: unknown) {
      if (typeof chunk === "string") chunks.push(chunk);
      else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk).toString("utf8"));
      ended = true;
      headersSent = true;
      return res;
    },
    on() {},
    once() {},
    emit() {},
  };
  return { res, chunks };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface ConflictHarness {
  root: string;
  server: any;
  plugin: any;
  routesFile: string;
  routeFile: string;
  getRegistered: () => (req: any, res: any, next: () => void) => void;
  setRootMethod: (method: string) => void;
}

async function bootstrapConflictPlugin(): Promise<ConflictHarness> {
  vi.spyOn(console, "error").mockImplementation(() => {});

  const root = await mkdtemp(path.join(tmpdir(), "farm-api-discovery-crash-"));
  tempDirs.add(root);
  const routeDir = path.join(root, "src", "api", "health");
  const routeFile = path.join(routeDir, "route.js");
  const routesFile = path.join(root, "src", "routes.js");
  await mkdir(routeDir, { recursive: true });
  await writeFile(routeFile, "export {};\n");
  await writeFile(routesFile, "export {};\n");

  let registered: ((req: any, res: any, next: () => void) => void) | undefined;
  let rootMethod = "GET";
  const server: any = {
    config: { root },
    ssrLoadModule: async (filePath: string) =>
      filePath === routeFile
        ? { GET: async () => new Response("file-get") }
        : {
            health: {
              __path: "/api/health",
              __method: rootMethod,
              handler: async () => new Response("root-get"),
            },
          },
    middlewares: {
      use(fn: any) {
        registered = fn;
      },
    },
    moduleGraph: { invalidateModule: vi.fn() },
    watcher: { on() {} },
  };

  const plugin = farmApiPlugin() as any;
  const register = await plugin.configureServer(server);
  register?.();

  await expect(server.__farmApi__.waitForDiscovery()).rejects.toThrow(
    "Duplicate API route for GET /api/health",
  );
  expect(server.__farmApi__.isReady()).toBe(false);

  return {
    root,
    server,
    plugin,
    routesFile,
    routeFile,
    getRegistered: () => registered!,
    setRootMethod: (method: string) => {
      rootMethod = method;
    },
  };
}

describe("farmApiPlugin request boundary after failed cold-start discovery", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  afterEach(() => {
    process.removeListener("unhandledRejection", onUnhandled);
    unhandled.length = 0;
  });

  it("answers 500 for /api requests and keeps the process alive", async () => {
    process.on("unhandledRejection", onUnhandled);

    const { getRegistered } = await bootstrapConflictPlugin();
    const registered = getRegistered();
    expect(registered).toBeDefined();

    const { res, chunks } = createNodeResponse();
    registered(createNodeRequest("/api/health"), res, () => {});
    await settle();

    expect(res.statusCode).toBe(500);
    expect(res.end).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
    expect(chunks.join("")).toContain("Internal server error");
    expect(unhandled).toEqual([]);
  });

  it("destroys the socket instead of double-sending when headers already went out", async () => {
    process.on("unhandledRejection", onUnhandled);

    const { getRegistered } = await bootstrapConflictPlugin();
    const { res } = createNodeResponse();
    Object.defineProperty(res, "headersSent", { value: true, configurable: true });

    getRegistered()(createNodeRequest("/api/health"), res, () => {});
    await settle();

    expect(res.destroy).toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it("serves requests again after HMR resolves the cold-start conflict", async () => {
    const { server, plugin, routesFile, getRegistered, setRootMethod } =
      await bootstrapConflictPlugin();

    setRootMethod("POST");

    await plugin.handleHotUpdate({ file: routesFile, modules: [], server });
    await expect(server.__farmApi__.waitForDiscovery()).resolves.toBeUndefined();
    expect(server.__farmApi__.isReady()).toBe(true);
    expect(server.__farmApi__.getRoutes().get("/api/health")?.methods.sort()).toEqual([
      "GET",
      "POST",
    ]);

    const { res, chunks } = createFullResponse();
    let passedToNext = false;
    getRegistered()(createNodeRequest("/api/health"), res, () => {
      passedToNext = true;
    });
    await settle();

    expect(passedToNext).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(chunks.join("")).toContain("file-get");
  });

  it("does not interfere with the happy path when discovery succeeds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const root = await mkdtemp(path.join(tmpdir(), "farm-api-discovery-ok-"));
    tempDirs.add(root);
    const routeDir = path.join(root, "src", "api", "health");
    const routeFile = path.join(routeDir, "route.js");
    await mkdir(routeDir, { recursive: true });
    await writeFile(routeFile, "export {};\n");

    let registered: ((req: any, res: any, next: () => void) => void) | undefined;
    const server: any = {
      config: { root },
      ssrLoadModule: async () => ({ GET: async () => new Response("ok-body") }),
      middlewares: {
        use(fn: any) {
          registered = fn;
        },
      },
      moduleGraph: { invalidateModule: vi.fn() },
      watcher: { on() {} },
    };

    const plugin = farmApiPlugin() as any;
    const register = await plugin.configureServer(server);
    register?.();
    await server.__farmApi__.waitForDiscovery();
    expect(server.__farmApi__.isReady()).toBe(true);

    const { res, chunks } = createFullResponse();
    let passedToNext = false;
    registered!(createNodeRequest("/api/health"), res, () => {
      passedToNext = true;
    });
    await settle();

    expect(passedToNext).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(chunks.join("")).toContain("ok-body");
  });
});
