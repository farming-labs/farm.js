// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer, type ProductionServer } from "./production-server";

// The same requests against a dev server and a node-server production build of one app: public
// HTML and directory indexes, `//`-prefixed and empty-segment paths, malformed percent-encoding,
// file paths with a trailing slash or a non-GET method, and dotted paths with no route.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-dev-production-path-parity-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(
    root,
    "src/app/layout.tsx",
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  for (const [route, marker] of [
    ["", "home-page"],
    ["about/", "about-page"],
    ["admin/", "admin-page"],
    ["console/about/", "console-about-page"],
    ["blog/[slug]/", "blog-page"],
  ]) {
    await writeModule(
      root,
      `src/app/${route}page.tsx`,
      `export default function Page() { return <main>${marker}</main>; }`,
    );
  }
  await writeModule(
    root,
    "src/app/not-found.tsx",
    `export default function NotFound() { return <main>custom-not-found</main>; }`,
  );
  await writeModule(
    root,
    "src/app/api/items/[id]/route.ts",
    `export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return Response.json({ id: (await context.params).id });
}`,
  );
  await writeModule(
    root,
    "src/app/middleware.ts",
    `export function middleware(request: Request, context: { headers: Headers }) {
  context.headers.set("x-mw-path", new URL(request.url).pathname);
}`,
  );
  await writeModule(root, "public/hello.txt", "hello-from-public");
  await writeModule(root, "public/landing.html", "<!doctype html><p>public-landing</p>");
  await writeModule(root, "public/sub/index.html", "<!doctype html><p>public-sub-index</p>");
  return root;
}

async function request(origin: string, pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${origin}${pathname}`, { redirect: "manual", ...init });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    middlewarePath: response.headers.get("x-mw-path"),
    body: await response.text(),
  };
}

async function expectPublicFile(origin: string, pathname: string, content: string, method = "GET") {
  const response = await request(origin, pathname, { method });
  expect(response.status, `${method} ${pathname}`).toBe(200);
  // Served before middleware, as Nitro's static handler does.
  expect(response.middlewarePath, `${method} ${pathname}`).toBeNull();
  expect(response.body, `${method} ${pathname}`).toBe(method === "HEAD" ? "" : content);
}

async function expectNotFoundPage(origin: string, pathname: string, method = "GET") {
  const response = await request(origin, pathname, { method });
  expect(response.status, `${method} ${pathname}`).toBe(404);
  expect(response.contentType, `${method} ${pathname}`).toMatch(/^text\/html/);
  expect(response.middlewarePath, `${method} ${pathname}`).toBe(pathname);
  expect(response.body, `${method} ${pathname}`).toContain("custom-not-found");
}

const MALFORMED_REQUEST_BODY = { error: true, status: 400, message: "Bad Request" };

/** Each case runs unchanged against the dev server and the production server. */
const cases: Record<string, (origin: string) => Promise<void>> = {
  "serves public HTML files and public directory indexes": async (origin) => {
    await expectPublicFile(origin, "/landing.html", "<!doctype html><p>public-landing</p>");
    for (const pathname of ["/sub/", "/sub", "/sub/index.html"]) {
      await expectPublicFile(origin, pathname, "<!doctype html><p>public-sub-index</p>");
    }
    await expectPublicFile(origin, "/sub", "", "HEAD");
    const page = await request(origin, "/about");
    expect(page.status).toBe(200);
    expect(page.middlewarePath).toBe("/about");
    expect(page.body).toContain("about-page");
  },

  "routes a leading double slash as a path, never as a host": async (origin) => {
    for (const pathname of ["//about/", "//admin/", "//about", "/console//about", "//"]) {
      await expectNotFoundPage(origin, pathname);
    }
    // Dynamic routes match segment by segment in both, skipping the empty segment.
    const dynamic = await request(origin, "//blog/first");
    expect(dynamic.status).toBe(200);
    expect(dynamic.middlewarePath).toBe("//blog/first");
    expect(dynamic.body).toContain("blog-page");
  },

  "rejects malformed percent-encoding with a 400 before middleware": async (origin) => {
    for (const pathname of ["/api/items/%ZZ", "/api/items/%E0%A4", "/blog/%ZZ/", "/blog/%ZZ"]) {
      const response = await request(origin, pathname);
      expect(response.status, pathname).toBe(400);
      expect(response.contentType, pathname).toMatch(/^application\/json/);
      expect(response.middlewarePath, pathname).toBeNull();
      expect(JSON.parse(response.body), pathname).toEqual(MALFORMED_REQUEST_BODY);
    }
    // Well-formed escapes still reach the route, decoded.
    const encoded = await request(origin, "/api/items/caf%C3%A9");
    expect(encoded.status).toBe(200);
    expect(JSON.parse(encoded.body)).toEqual({ id: "café" });
  },

  "serves a public file with a trailing slash, and only to GET and HEAD": async (origin) => {
    await expectPublicFile(origin, "/hello.txt", "hello-from-public");
    await expectPublicFile(origin, "/hello.txt/", "hello-from-public");
    await expectNotFoundPage(origin, "/hello.txt", "POST");
  },

  "runs middleware and renders the not-found page for dotted paths with no route": async (
    origin,
  ) => {
    await expectNotFoundPage(origin, "/nope.txt");
    await expectNotFoundPage(origin, "/files/report.pdf");
    await expectNotFoundPage(origin, "/missing");
  },
};

describe("development", () => {
  let root: string;
  let server: ViteDevServer | undefined;
  let origin = "";

  beforeAll(async () => {
    root = await createFixture();
    server = await createServer({ root, images: { provider: "none" } });
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    origin = `http://localhost:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await server?.close();
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  for (const [name, check] of Object.entries(cases)) {
    it(name, () => check(origin), 30_000);
  }
});

// After the dev suite: the build sets NODE_ENV=production for this process.
describe("production (node-server)", () => {
  let root: string;
  let origin = "";
  let server: ProductionServer | undefined;

  beforeAll(async () => {
    root = await createFixture();
    const config = await resolveConfig({ root, images: { provider: "none" } }, "production");
    await build(config, { root, preset: "node-server" });

    server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    origin = server.origin;
  }, 240_000);

  afterAll(async () => {
    await server?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  for (const [name, check] of Object.entries(cases)) {
    it(name, () => check(origin), 30_000);
  }
});
