// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { farmApiPlugin } from "../api/vite-plugin";

const tempDirs = new Set<string>();

function decodeChunk(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return String(chunk);
}

afterEach(async () => {
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
async function createDevHarness(routes: Record<string, string>): Promise<DevHarness> {
  const root = await mkdtemp(path.join(tmpdir(), "farm-api-rewrite-"));
  tempDirs.add(root);

  for (const [routePath, source] of Object.entries(routes)) {
    const dir = path.join(root, "src", "api", routePath);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "route.js"), source);
  }

  const plugin = farmApiPlugin() as any;
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
