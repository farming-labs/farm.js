// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { farmApiPlugin } from "../api/vite-plugin";

const tempDirs = new Set<string>();

function decodeChunk(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return String(chunk);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    [...tempDirs].map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
      tempDirs.delete(dir);
    }),
  );
});

interface DevHarness {
  dispatch(
    url: string,
    rewriteTo?: string | null,
  ): Promise<{
    status: number;
    body: string | null;
    passedToNext: boolean;
  }>;
}

/**
 * Boots the plugin's dev middleware against a real temp app dir, with a
 * middleware stub that mimics ctx.rewrite() by mutating req.url — exactly
 * what middleware/context.ts does.
 */
async function createDevHarness(
  routes: Record<string, string>,
  options: { basePath?: string } = {},
): Promise<DevHarness> {
  const root = await mkdtemp(path.join(tmpdir(), "farm-api-rewrite-"));
  tempDirs.add(root);

  for (const [routePath, source] of Object.entries(routes)) {
    const dir = path.join(root, "src", "api", routePath);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "route.js"), source);
  }

  const plugin = farmApiPlugin(options) as any;
  let handlerFn: ((req: any, res: any, next: () => void) => Promise<void>) | undefined;

  const server = {
    config: { root },
    ssrLoadModule: (filePath: string) => import(pathToFileURL(filePath).href),
    middlewares: {
      use(fn: typeof handlerFn) {
        handlerFn = fn;
      },
    },
    watcher: { on() {} },
  };

  const register = await plugin.configureServer(server);
  register?.();
  await (server as any).__farmApi__?.waitForDiscovery?.();
  if (!handlerFn) throw new Error("dev middleware was not registered");

  return {
    async dispatch(url, rewriteTo = null) {
      (server as any).__farmMiddleware__ = {
        waitForDiscovery: async () => {},
        async execute(req: any) {
          if (rewriteTo) req.url = rewriteTo;
          return false;
        },
      };

      let passedToNext = false;
      let body: string | null = null;
      const req = {
        url,
        method: "GET",
        headers: { host: "localhost:3000" },
      };
      const res: any = {
        statusCode: 200,
        headersSent: false,
        writableEnded: false,
        setHeader() {},
        getHeader() {
          return undefined;
        },
        writeHead(status: number) {
          res.statusCode = status;
          res.headersSent = true;
          return res;
        },
        write(chunk: unknown) {
          body = (body ?? "") + decodeChunk(chunk);
          return true;
        },
        end(chunk?: unknown) {
          if (chunk !== undefined) body = (body ?? "") + decodeChunk(chunk);
          res.writableEnded = true;
        },
        on() {},
        once() {},
        emit() {},
      };

      await handlerFn!(req, res, () => {
        passedToNext = true;
      });
      // sendWebResponse may finish asynchronously.
      for (let waited = 0; waited < 200 && !res.writableEnded && !passedToNext; waited += 5) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { status: res.statusCode, body, passedToNext };
    },
  };
}

describe("dev API dispatch after middleware rewrites", () => {
  it("rejects dynamic routes that have the same URL shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      createDevHarness({
        "users/[id]": `export const GET = async () => new Response("id");\n`,
        "users/[slug]": `export const GET = async () => new Response("slug");\n`,
      }),
    ).rejects.toThrow("Ambiguous API routes");
  });

  it("reports ambiguous routes introduced by HMR", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "farm-api-ambiguous-hmr-"));
    tempDirs.add(root);
    const idDir = path.join(root, "src", "api", "users", "[id]");
    const slugDir = path.join(root, "src", "api", "users", "[slug]");
    const idFile = path.join(idDir, "route.ts");
    const slugFile = path.join(slugDir, "route.ts");
    const routesFile = path.join(root, "src", "routes.ts");
    await mkdir(idDir, { recursive: true });
    await writeFile(idFile, "export {};\n");
    await writeFile(routesFile, "export {};\n");

    let rootModule: Record<string, unknown> = {};
    const server: any = {
      config: { root },
      ssrLoadModule: async (filePath: string) =>
        filePath === routesFile ? rootModule : { GET: async () => new Response("ok") },
      moduleGraph: { invalidateModule() {} },
      middlewares: { use() {} },
      watcher: { on() {} },
    };
    const plugin = farmApiPlugin() as any;
    await plugin.configureServer(server);
    await server.__farmApi__.waitForDiscovery();

    rootModule = {
      slug: {
        __path: "/api/users/[slug]",
        __method: "GET",
        handler: async () => new Response("slug"),
      },
    };
    await expect(plugin.handleHotUpdate({ file: routesFile, modules: [], server })).rejects.toThrow(
      "Ambiguous API routes",
    );

    rootModule = {};
    await mkdir(slugDir, { recursive: true });
    await writeFile(slugFile, "export {};\n");
    await expect(plugin.handleHotUpdate({ file: slugFile, modules: [], server })).rejects.toThrow(
      "Ambiguous API routes",
    );
  });

  it("reports duplicate methods across file and explicit routes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "farm-api-conflict-"));
    tempDirs.add(root);
    const routeDir = path.join(root, "src", "api", "health");
    const routeFile = path.join(routeDir, "route.js");
    const routesFile = path.join(root, "src", "routes.js");
    await mkdir(routeDir, { recursive: true });
    await writeFile(routeFile, "export {};\n");
    await writeFile(routesFile, "export {};\n");

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const plugin = farmApiPlugin() as any;
    let apiMiddleware: ((req: any, res: any, next: () => void) => Promise<void>) | undefined;
    let rootMethod = "GET";
    const server = {
      config: { root },
      ssrLoadModule: async (filePath: string) =>
        filePath === routeFile
          ? { GET: async () => new Response("file") }
          : {
              health: {
                __path: "/api/health",
                __method: rootMethod,
                handler: async () => new Response("explicit"),
              },
            },
      middlewares: {
        use(handler: typeof apiMiddleware) {
          apiMiddleware = handler;
        },
      },
      moduleGraph: { invalidateModule: vi.fn() },
      watcher: { on() {} },
    };

    const register = await plugin.configureServer(server);
    register?.();

    await expect((server as any).__farmApi__.waitForDiscovery()).rejects.toThrow(
      `Duplicate API route for GET /api/health: ${routeFile} conflicts with ${routesFile}`,
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[FARM] API discovery error:",
      expect.objectContaining({ name: "APIRouteConflictError" }),
    );

    await expect(
      apiMiddleware!(
        { url: "/api/health", method: "GET", headers: {} },
        { once() {}, writableEnded: false },
        vi.fn(),
      ),
    ).rejects.toThrow("Duplicate API route for GET /api/health");

    rootMethod = "POST";
    await plugin.handleHotUpdate({ file: routesFile, modules: [], server });
    await expect((server as any).__farmApi__.waitForDiscovery()).resolves.toBeUndefined();
    expect((server as any).__farmApi__.isReady()).toBe(true);
    expect((server as any).__farmApi__.getRoutes().get("/api/health")?.methods.sort()).toEqual([
      "GET",
      "POST",
    ]);
  });

  it("serves canonical routes through the configured local base path", async () => {
    const harness = await createDevHarness(
      {
        users: `export const GET = async () => Response.json({ source: "custom-base" });\n`,
      },
      { basePath: "/v2/api" },
    );

    const result = await harness.dispatch("/v2/api/users");
    expect(result.passedToNext).toBe(false);
    expect(JSON.parse(result.body ?? "")).toEqual({ source: "custom-base" });
  });

  it("dispatches the rewritten endpoint like production", async () => {
    const harness = await createDevHarness({
      "v1/users": `export const GET = async () => Response.json({ version: "v1" });\n`,
      "v2/users": `export const GET = async () => Response.json({ version: "v2" });\n`,
    });

    const direct = await harness.dispatch("/api/v1/users");
    expect(direct.passedToNext).toBe(false);
    expect(JSON.parse(direct.body ?? "")).toEqual({ version: "v1" });

    const rewritten = await harness.dispatch("/api/v1/users", "/api/v2/users");
    expect(rewritten.passedToNext).toBe(false);
    expect(JSON.parse(rewritten.body ?? "")).toEqual({ version: "v2" });
  });

  it("hands rewrites that leave the API surface to the page pipeline", async () => {
    const harness = await createDevHarness({
      "v1/users": `export const GET = async () => Response.json({ version: "v1" });\n`,
    });

    const result = await harness.dispatch("/api/v1/users", "/dashboard");
    expect(result.passedToNext).toBe(true);
    expect(result.body).toBeNull();
  });
});
