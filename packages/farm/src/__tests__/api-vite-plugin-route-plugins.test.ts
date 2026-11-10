// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRoutesFactory } from "../api/route";
import { farmApiPlugin } from "../api/vite-plugin";

const tempDirs = new Set<string>();

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    [...tempDirs].map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
      tempDirs.delete(dir);
    }),
  );
});

type RoutePlugin = { name: string; routes?: PluginRoutesFactory };

/** Boots the plugin's dev middleware against a temp app with the given file routes. */
async function createDevHarness(
  routes: Record<string, string>,
  plugins?: (context: { root: string }) => readonly RoutePlugin[] | Promise<readonly RoutePlugin[]>,
  serverFields: Record<string, unknown> = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "farm-api-route-plugins-"));
  tempDirs.add(root);
  await mkdir(path.join(root, "src", "api"), { recursive: true });
  for (const [routePath, source] of Object.entries(routes)) {
    const dir = path.join(root, "src", "api", routePath);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "route.js"), source);
  }

  const plugin = farmApiPlugin(plugins ? { plugins } : {}) as any;
  let handlerFn: ((req: any, res: any, next: () => void) => Promise<void>) | undefined;
  const server: any = {
    config: { root, server: {} },
    environments: {
      ssr: { runner: { import: (filePath: string) => import(pathToFileURL(filePath).href) } },
    },
    middlewares: {
      use(fn: typeof handlerFn) {
        handlerFn = fn;
      },
    },
    watcher: { on() {} },
    ...serverFields,
  };
  const register = await plugin.configureServer(server);
  register?.();
  await server.__farmApi__.waitForDiscovery();

  return {
    root,
    async dispatch(url: string, method = "GET", host = "localhost:3000") {
      let passedToNext = false;
      let body = "";
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
          body += Buffer.from(chunk as Uint8Array).toString("utf8");
          return true;
        },
        end(chunk?: unknown) {
          if (chunk !== undefined) body += String(chunk);
          res.writableEnded = true;
        },
        on() {},
        once() {},
        emit() {},
      };
      await handlerFn!({ url, method, headers: { host } }, res, () => {
        passedToNext = true;
      });
      for (let waited = 0; waited < 200 && !res.writableEnded && !passedToNext; waited += 5) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { status: res.statusCode, body, passedToNext };
    },
  };
}

const echoPlugin: RoutePlugin = {
  name: "echo",
  routes: ({ route, api }) => [
    route.get("/api/echo", {
      handler: () => Response.json({ endpoints: api.list().map((e) => `${e.method} ${e.path}`) }),
    }),
  ],
};

describe("dev API route plugins", () => {
  it("serves plugin routes in an app with no API files", async () => {
    const harness = await createDevHarness({}, () => [echoPlugin]);
    const response = await harness.dispatch("/api/echo");
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ endpoints: [] });
  });

  it("gives plugins the app's endpoints and keeps serving file routes", async () => {
    const plugins = vi.fn(async () => [echoPlugin]);
    const harness = await createDevHarness(
      { users: `export const GET = async () => new Response("users");\n` },
      plugins,
    );
    expect(plugins).toHaveBeenCalledWith({ root: harness.root });

    const echo = await harness.dispatch("/api/echo");
    expect(JSON.parse(echo.body)).toEqual({ endpoints: ["GET /api/users"] });
    const users = await harness.dispatch("/api/users");
    expect(users.body).toBe("users");
  });

  it("rejects a plugin route that replaces an app endpoint", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const clash: RoutePlugin = {
      name: "clash",
      routes: ({ route }) => [route.get("/api/users", { handler: () => new Response("plugin") })],
    };
    await expect(
      createDevHarness({ users: `export const GET = async () => new Response("users");\n` }, () => [
        clash,
      ]),
    ).rejects.toThrow("Duplicate API route for GET /api/users");
  });

  it("passes unknown paths on without plugins, as before", async () => {
    const harness = await createDevHarness({
      users: `export const GET = async () => new Response("users");\n`,
    });
    expect((await harness.dispatch("/api/echo")).passedToNext).toBe(true);
    expect((await harness.dispatch("/api/users")).body).toBe("users");
  });

  it("dispatches a plugin's endpoint call to its own listener, not the request's host", async () => {
    const listen = async (body: string, seen: string[]) => {
      const server = http.createServer((request, response) => {
        seen.push(`${request.url} host=${request.headers.host}`);
        response.end(body);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return server;
    };
    const ownSeen: string[] = [];
    const internalSeen: string[] = [];
    // Stands in for the Vite dev server's listener, and for an internal-only service.
    const own = await listen("own listener", ownSeen);
    const internal = await listen("INTERNAL-SERVICE-SECRET", internalSeen);
    const internalPort = (internal.address() as { port: number }).port;
    try {
      const forward: RoutePlugin = {
        name: "forward",
        routes: ({ route, api }) => [
          route.get("/api/forward", {
            handler: (request) =>
              api.get("GET", "/api/users")!.invoke(new Request(new URL("/api/users", request.url))),
          }),
        ],
      };
      const harness = await createDevHarness(
        { users: `export const GET = async () => new Response("users");\n` },
        () => [forward],
        { httpServer: own },
      );
      const response = await harness.dispatch("/api/forward", "GET", `localhost:${internalPort}`);
      expect(response.body).toBe("own listener");
      expect(ownSeen).toEqual([`/api/users host=localhost:${internalPort}`]);
      expect(internalSeen).toEqual([]);
    } finally {
      await Promise.all(
        [own, internal].map((server) => new Promise((resolve) => server.close(resolve))),
      );
    }
  });
});
