// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { farmApiPlugin } from "../api/vite-plugin";

const tempDirs = new Set<string>();

afterEach(async () => {
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
});

/** Serves `GET /api/consent` from `routeDir` in a temp app and returns what the plugin answers. */
async function requestConsent(routeDir: string, options: { apiDir?: string }) {
  const root = await mkdtemp(path.join(tmpdir(), "farm-api-dir-"));
  tempDirs.add(root);
  const dir = path.join(root, routeDir, "consent");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "route.js"),
    `export const GET = async () => new Response("consent");\n`,
  );

  const plugin = farmApiPlugin(options) as any;
  let handler: ((req: any, res: any, next: () => void) => Promise<void>) | undefined;
  const server: any = {
    config: { root, server: {} },
    environments: {
      ssr: { runner: { import: (file: string) => import(pathToFileURL(file).href) } },
    },
    middlewares: { use: (fn: typeof handler) => (handler = fn) },
    watcher: { on() {} },
  };
  (await plugin.configureServer(server))?.();
  await server.__farmApi__.waitForDiscovery();

  let body = "";
  let passedToNext = false;
  const res: any = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    setHeader() {},
    getHeader() {},
    writeHead(status: number) {
      res.statusCode = status;
      res.headersSent = true;
      return res;
    },
    write(chunk: Uint8Array) {
      body += Buffer.from(chunk).toString("utf8");
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
  await handler!(
    { url: "/api/consent", method: "GET", headers: { host: "localhost" } },
    res,
    () => {
      passedToNext = true;
    },
  );
  for (let waited = 0; waited < 200 && !res.writableEnded && !passedToNext; waited += 5) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return passedToNext ? "next" : body;
}

describe("dev API route directory", () => {
  it("defaults to <srcDir>/api", async () => {
    expect(await requestConsent("src/api", {})).toBe("consent");
  });

  it("serves routes from apiDir, where the RSC pipeline's production server finds them", async () => {
    expect(await requestConsent("src/app/api", { apiDir: "src/app/api" })).toBe("consent");
    expect(await requestConsent("src/api", { apiDir: "src/app/api" })).toBe("next");
  });
});
