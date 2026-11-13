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

/**
 * Serves `GET /api/locale` in a temp app whose Vite config carries `i18n`, as the RSC pipeline's
 * does, and returns what the plugin answers. The route reads the request's locale where
 * getLocale() reads it.
 */
async function requestLocale(i18n: unknown, headers: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "farm-api-i18n-"));
  tempDirs.add(root);
  await mkdir(path.join(root, "src/messages"), { recursive: true });
  for (const locale of ["en", "fr"]) {
    await writeFile(path.join(root, `src/messages/${locale}.json`), "{}");
  }
  await mkdir(path.join(root, "src/api/locale"), { recursive: true });
  await writeFile(
    path.join(root, "src/api/locale/route.js"),
    `export const GET = async () => {
  const state = globalThis[Symbol.for("farm.i18n.requestStore")]?.getStore();
  return Response.json({ locale: state ? state.resolution.locale : null });
};\n`,
  );

  const plugin = farmApiPlugin({}) as any;
  let handler: ((req: any, res: any, next: () => void) => Promise<void>) | undefined;
  const server: any = {
    config: { root, server: {}, i18n },
    environments: {
      ssr: { runner: { import: (file: string) => import(pathToFileURL(file).href) } },
    },
    middlewares: { use: (fn: typeof handler) => (handler = fn) },
    watcher: { on() {} },
  };
  (await plugin.configureServer(server))?.();
  await server.__farmApi__.waitForDiscovery();

  let body = "";
  const responseHeaders = new Map<string, unknown>();
  const res: any = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    setHeader(name: string, value: unknown) {
      responseHeaders.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return responseHeaders.get(name.toLowerCase());
    },
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
    { url: "/api/locale", method: "GET", headers: { host: "localhost", ...headers } },
    res,
    () => {},
  );
  for (let waited = 0; waited < 200 && !res.writableEnded; waited += 5) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { status: res.statusCode, body: JSON.parse(body), headers: responseHeaders };
}

describe("dev API routes with i18n", () => {
  it("run in the request's locale, from the same signals as pages, without redirecting", async () => {
    const i18n = { locales: ["en", "fr"], defaultLocale: "en" };
    const french = await requestLocale(i18n, { "accept-language": "fr" });
    expect(french.status).toBe(200);
    expect(french.body).toEqual({ locale: "fr" });
    expect(String(french.headers.get("vary"))).toContain("Accept-Language");
    expect(String(french.headers.get("set-cookie"))).toContain("farm_locale=fr");

    const fallback = await requestLocale(i18n, { "accept-language": "de" });
    expect(fallback.body).toEqual({ locale: "en" });
  });

  it("leave an app without i18n outside any locale", async () => {
    const response = await requestLocale(undefined, { "accept-language": "fr" });
    expect(response.body).toEqual({ locale: null });
  });
});
