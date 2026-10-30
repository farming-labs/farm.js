// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig, resolveDocsConfig } from "../config";
import { createDocsAPI, createFarmDocsAPIHandler, createFarmDocsHandler } from "../docs";
import {
  assertFarmDocsAdapterServesNoGuardedPages,
  createFarmDocsAdapterHandler,
} from "../docs/adapter";
import { compileFarmDocsManifest } from "../docs/compiler";
import { createFarmDocsPrecompiledRuntime } from "../docs/precompiled-runtime";
import { farmPathGuardCoversPage } from "../middleware/may-handle";
import { getFarmDocsGuardedPaths } from "../nitro/universal-build";
import { startDevServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

// Docs pages behind a guard reached anonymous visitors anyway: the docs API (Markdown by
// path, llms, search), the root llms-full.txt and the sitemaps answer anyone, and a guard
// written for the page alone never met its `.md` URL. A signed-in reader's page also
// carried a shared Cache-Control, so a CDN could hand it to anyone.

const SECRET = "TOPSECRET-RUNBOOK";
const RUNBOOK_SECRET = "RUNBOOK-ONLY-STEPS";

const FARM_CONFIG = `
import { defineConfig } from "@farm.js/core";

const signedIn = (ctx) => {
  const h = ctx.request.headers;
  const cookie = typeof h.get === "function" ? h.get("cookie") : h.cookie;
  return String(cookie || "").includes("session=ok");
};

export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  vite: { server: { host: "127.0.0.1", strictPort: false } },
  docs: { enabled: true },
  middleware: [
    {
      matcher: ["/docs/internal", "/docs/internal.md", "/docs/internal/:path*"],
      handler(ctx) {
        if (!signedIn(ctx)) return ctx.text("GUARD-BLOCKED", 401);
      },
    },
    {
      // Written for the page alone: it never meets /docs/runbook.md.
      matcher: "/docs/runbook/:path*",
      handler(ctx) {
        if (!signedIn(ctx)) return ctx.text("GUARD-BLOCKED", 401);
      },
    },
  ],
});
`;

async function createFixture(): Promise<string> {
  const packageRoot = process.cwd();
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-docs-guarded-pages-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const dependency of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", dependency)),
      path.join(root, "node_modules", dependency),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  await fs.writeFile(path.join(root, "farm.config.ts"), FARM_CONFIG);
  const write = async (relativePath: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  };
  await write("src/app/page.tsx", "export default function Page() { return <main>home</main>; }");
  await write(
    "src/app/docs/page.md",
    "---\ntitle: Public docs\n---\n# Public docs\n\nPUBLIC-WELCOME for everyone.\n",
  );
  await write(
    "src/app/docs/internal/page.md",
    `---\ntitle: Secret runbook\n---\n# Secret runbook\n\n${SECRET}: rotate the database password.\n`,
  );
  await write(
    "src/app/docs/runbook/page.md",
    `---\ntitle: Ops runbook\n---\n# Ops runbook\n\n${RUNBOOK_SECRET} for on-call.\n`,
  );
  return root;
}

// Every anonymous path that used to answer with guarded docs content.
const ANONYMOUS_PATHS = [
  "/docs/internal",
  "/docs/internal.md",
  "/docs/runbook",
  "/docs/runbook.md",
  "/api/docs/internal.md",
  "/api/docs/runbook.md",
  "/api/docs?format=markdown&path=internal",
  "/api/docs?format=llms",
  "/api/docs?format=llms-full",
  "/api/docs/llms-full.txt",
  "/api/docs?format=sitemap-xml",
  "/api/docs?format=sitemap-md",
  "/api/docs/agent/spec",
  `/api/docs?q=${SECRET}`,
  `/api/docs?q=${RUNBOOK_SECRET}`,
  "/api/docs?q=runbook",
  "/llms.txt",
  "/llms-full.txt",
  "/sitemap.xml",
  "/docs/_social/internal/opengraph-image.svg",
];

async function expectGuardedDocsStayPrivate(send: (request: Request) => Promise<Response>) {
  for (const pathname of ANONYMOUS_PATHS) {
    const response = await send(new Request(`http://farm.test${pathname}`));
    const body = await response.text();
    expect({
      pathname,
      leaks: [SECRET, RUNBOOK_SECRET, "Secret runbook", "Ops runbook"].filter((secret) =>
        body.includes(secret),
      ),
    }).toEqual({ pathname, leaks: [] });
  }

  // Public docs keep every surface.
  const publicPage = await send(new Request("http://farm.test/docs"));
  expect(publicPage.status).toBe(200);
  await publicPage.body?.cancel();
  for (const pathname of [
    "/docs.md",
    "/api/docs?format=markdown&path=docs",
    "/api/docs?format=llms-full",
    "/llms-full.txt",
    "/api/docs?q=PUBLIC-WELCOME",
  ]) {
    const response = await send(new Request(`http://farm.test${pathname}`));
    expect({ pathname, status: response.status }).toEqual({ pathname, status: 200 });
    expect({ pathname, listed: (await response.text()).includes("PUBLIC-WELCOME") }).toEqual({
      pathname,
      listed: true,
    });
  }
}

describe("docs pages a path guard covers", () => {
  it("stay off anonymous docs surfaces in development and production", async () => {
    const root = await createFixture();
    try {
      const dev = await startDevServer({ root }, await getAvailablePort());
      try {
        const address = dev.httpServer!.address();
        if (!address || typeof address === "string") throw new Error("Dev server did not bind");
        await expectGuardedDocsStayPrivate((request) => {
          const url = new URL(request.url);
          return fetch(
            new Request(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, request),
          );
        });
      } finally {
        await dev.close();
      }

      const config = await resolveConfig(
        { ...(await loadConfig(root, undefined, "production")), root },
        "production",
      );
      await build(config, { root, preset: "vercel" });
      const entry = path.join(root, ".vercel", "output", "functions", "__nitro.func", "index.mjs");
      const server = (await import(/* @vite-ignore */ pathToFileURL(entry).href)).default;
      const send = (request: Request) => server.fetch(request) as Promise<Response>;
      await expectGuardedDocsStayPrivate(send);

      // The guard still decides the page itself.
      const anonymous = await send(new Request("http://farm.test/docs/internal"));
      expect(anonymous.status).toBe(401);
      await anonymous.body?.cancel();

      // A signed-in reader's copy is theirs: never a shared cache entry.
      for (const pathname of ["/docs/internal", "/docs/internal.md", "/api/docs?format=llms"]) {
        const signedIn = await send(
          new Request(`http://farm.test${pathname}`, { headers: { cookie: "session=ok" } }),
        );
        expect({ pathname, status: signedIn.status }).toEqual({ pathname, status: 200 });
        expect({ pathname, cache: signedIn.headers.get("cache-control") }).toEqual({
          pathname,
          cache: "private, no-store",
        });
        if (pathname !== "/api/docs?format=llms") expect(await signedIn.text()).toContain(SECRET);
        else await signedIn.body?.cancel();
      }
      // An anonymous public page keeps its shared caching.
      const publicPage = await send(new Request("http://farm.test/docs"));
      expect(publicPage.headers.get("cache-control")).toBe(
        "public, s-maxage=60, stale-while-revalidate=300",
      );
      await publicPage.body?.cancel();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 240_000);

  it("are decided from path-specific guards only, as the page listings are", async () => {
    const root = await createFixture();
    try {
      const docs = await resolveDocsConfig({ entry: "/docs" }, { root, srcDir: "src" });
      const guardedPaths = (middleware: unknown, middlewareRoutes: { path: string }[] = []) =>
        getFarmDocsGuardedPaths(
          { docs, root, srcDir: "src", middleware } as never,
          middlewareRoutes,
        );

      expect(guardedPaths([{ matcher: "/docs/:path*" }])).toEqual([
        "/docs",
        "/docs/internal",
        "/docs/internal.md",
        "/docs/runbook",
        "/docs/runbook.md",
      ]);
      expect(guardedPaths([{ matcher: "/docs/runbook/:path*" }])).toEqual(["/docs/runbook"]);
      // A middleware.ts in the page's folder never runs for its `.md` URL.
      expect(guardedPaths([], [{ path: "/docs/internal" }])).toEqual(["/docs/internal"]);
      // Guards that cover every path name no page, so public docs stay listed.
      expect(guardedPaths([{ handler() {} }], [{ path: "/" }])).toEqual([]);
      expect(guardedPaths([{ matcher: "/(.*)" }, { matcher: () => true }])).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("are left out by the docs handlers a route file or the edge compiler mounts", async () => {
    const root = await createFixture();
    try {
      const docs = await resolveDocsConfig({ entry: "/docs" }, { root, srcDir: "src" });
      const guards = {
        config: {
          middleware: [
            { matcher: ["/docs/internal", "/docs/internal.md", "/docs/internal/:path*"] },
          ],
        },
        middlewareRoutes: [],
      } as never;
      const isPathGuarded = (pathname: string) => farmPathGuardCoversPage(guards, pathname);
      const api = createFarmDocsAPIHandler({ rootDir: root, srcDir: "src", docs, isPathGuarded });
      const handler = createFarmDocsHandler(docs, { root, srcDir: "src", isPathGuarded });

      const read = async (response: Response | null) => ({
        status: response?.status,
        leaks: (await response?.text())?.includes(SECRET) ?? false,
      });
      expect(await read(await api(new Request("http://farm.test/api/docs/internal.md")))).toEqual({
        status: 404,
        leaks: false,
      });
      expect(
        await read(await api(new Request(`http://farm.test/api/docs?q=${SECRET}`))),
      ).toMatchObject({ leaks: false });
      expect(
        await read(await api(new Request("http://farm.test/api/docs?format=llms-full"))),
      ).toMatchObject({ status: 200, leaks: false });
      expect(await read(await handler(new Request("http://farm.test/llms-full.txt")))).toEqual({
        status: 200,
        leaks: false,
      });
      // The page and its covered `.md` URL still answer: the guard runs before them.
      expect(await read(await handler(new Request("http://farm.test/docs/internal.md")))).toEqual({
        status: 200,
        leaks: true,
      });

      // The edge runtime serves what the compiler recorded with the same handlers.
      const edge = createFarmDocsPrecompiledRuntime(
        await compileFarmDocsManifest(docs, {
          root,
          srcDir: "src",
          clientEntry: "/farm-client.js",
          fontAssets: [],
          isPathGuarded,
        }),
      );
      for (const pathname of [
        "/api/docs/internal.md",
        `/api/docs?q=${SECRET}`,
        "/api/docs?format=llms-full",
      ]) {
        const response = await edge.handleAPIRequest(new Request(`http://farm.test${pathname}`));
        expect({ pathname, ...(await read(response)) }).toMatchObject({ pathname, leaks: false });
      }
      expect(
        await read(await edge.handleDocsRequest(new Request("http://farm.test/llms-full.txt"))),
      ).toEqual({ status: 200, leaks: false });

      // A src/app/api/docs route file gets the paths the build recorded.
      const previousRuntimeConfig = globalThis.__FARM_DOCS_RUNTIME_CONFIG__;
      try {
        globalThis.__FARM_DOCS_RUNTIME_CONFIG__ = {
          root,
          srcDir: "src",
          docs,
          guardedPaths: ["/docs/internal"],
        };
        const route = createDocsAPI();
        expect(
          await read(await route.GET(new Request("http://farm.test/api/docs/internal.md"))),
        ).toEqual({ status: 404, leaks: false });
      } finally {
        globalThis.__FARM_DOCS_RUNTIME_CONFIG__ = previousRuntimeConfig;
      }

      // Unguarded docs are untouched.
      const publicLlms = await createFarmDocsHandler(docs, { root, srcDir: "src" })(
        new Request("http://farm.test/llms-full.txt"),
      );
      expect(await publicLlms?.text()).toContain(SECRET);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("are not reached through another spelling of their slug", async () => {
    // The guard check keys on the page's canonical href, but the lookup used to
    // accept any slug that resolved to the file: `internal//secret`, `Internal/secret`
    // on a case-insensitive disk, `internal/secret/page`, a symlinked folder.
    const root = await createFixture();
    try {
      const write = async (relativePath: string, source: string) => {
        await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
        await fs.writeFile(path.join(root, relativePath), source);
      };
      await write("src/app/docs/internal/secret/page.md", `# Deep secret\n\n${SECRET}\n`);
      await write("src/app/docs/guides/setup.md", "# Setup\n\nPUBLIC-SETUP steps.\n");
      await fs.symlink(
        path.join(root, "src/app/docs/internal"),
        path.join(root, "src/app/docs/alias"),
        "junction",
      );

      const docs = await resolveDocsConfig({ entry: "/docs" }, { root, srcDir: "src" });
      const guarded = new Set([
        "/docs/internal",
        "/docs/internal.md",
        "/docs/internal/secret",
        "/docs/internal/secret.md",
      ]);
      const isPathGuarded = (pathname: string) => guarded.has(pathname);
      const api = createFarmDocsAPIHandler({ rootDir: root, srcDir: "src", docs, isPathGuarded });
      const handler = createFarmDocsHandler(docs, { root, srcDir: "src", isPathGuarded });
      const read = async (response: Response | null) => ({
        status: response?.status ?? null,
        leaks: (await response?.text())?.includes(SECRET) ?? false,
      });

      for (const pathname of [
        "/api/docs?format=markdown&path=internal/secret",
        "/api/docs?format=markdown&path=internal//secret",
        "/api/docs?format=markdown&path=docs/internal//secret",
        "/api/docs?format=markdown&path=internal/./secret",
        "/api/docs?format=markdown&path=Internal/secret",
        "/api/docs?format=markdown&path=internal/secret/page",
        "/api/docs?format=markdown&path=alias/secret",
        "/api/docs?format=markdown&path=alias",
        "/api/docs/internal//secret.md",
        "/api/docs/Internal/secret.md",
      ]) {
        const response = await api(new Request(`http://farm.test${pathname}`));
        expect({ pathname, ...(await read(response)) }).toEqual({
          pathname,
          status: 404,
          leaks: false,
        });
      }
      for (const pathname of [
        "/docs/internal//secret",
        "/docs/internal//secret.md",
        "/docs/Internal/secret.md",
        "/docs/internal/secret/page.md",
        "/docs/alias/secret.md",
        "/docs/_social/internal//secret/opengraph-image.svg",
        "/docs/_social/Internal/secret/opengraph-image.svg",
      ]) {
        const response = await handler(new Request(`http://farm.test${pathname}`));
        expect({ pathname, ...(await read(response)) }).toEqual({
          pathname,
          status: null,
          leaks: false,
        });
      }

      // Public pages keep their canonical URLs, nested and with a trailing slash.
      for (const pathname of [
        "/api/docs?format=markdown&path=docs",
        "/api/docs?format=markdown&path=guides/setup",
        "/api/docs?format=markdown&path=/guides/setup/",
        "/api/docs/guides/setup.md",
      ]) {
        const response = await api(new Request(`http://farm.test${pathname}`));
        expect({ pathname, status: response?.status }).toEqual({ pathname, status: 200 });
        await response?.body?.cancel();
      }
      for (const pathname of ["/docs", "/docs.md", "/docs/guides/setup", "/docs/guides/setup/"]) {
        const response = await handler(new Request(`http://farm.test${pathname}`));
        expect({ pathname, status: response?.status }).toEqual({ pathname, status: 200 });
        await response?.body?.cancel();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("refuse a docs adapter, which serves every page without the app's guards", async () => {
    const root = await createFixture();
    try {
      const resolved = await resolveDocsConfig({ entry: "/docs" }, { root, srcDir: "src" });
      const docs = {
        ...resolved,
        adapter: { protocol: 1, id: "@farming-labs/farmjs", server: "adapter/server", react: "x" },
      } as typeof resolved;
      const guarded = new Set(["/docs/internal", "/docs/runbook"]);
      const isPathGuarded = (pathname: string) => guarded.has(pathname);
      const adapterHandler = async () => null;
      const options = {
        root,
        srcDir: "src",
        clientEntry: "/farm-client.js",
        loadModule: async () => ({ createFarmDocsRuntimeHandler: () => adapterHandler }),
      };

      // Dev start and the production build both refuse it, naming the pages.
      await expect(
        createFarmDocsAdapterHandler(docs, { ...options, isPathGuarded }),
      ).rejects.toThrow(
        /\/docs\/internal, \/docs\/runbook\) would be public.*docs\.adapter = false/,
      );
      expect(() =>
        assertFarmDocsAdapterServesNoGuardedPages(
          docs,
          { root, srcDir: "src" },
          (pathname) => pathname === "/docs/internal.md",
        ),
      ).toThrow(/\(\/docs\/internal\) would be public/);

      // Without guarded pages, or with Farm's own runtime, nothing changes.
      expect(
        await createFarmDocsAdapterHandler(docs, { ...options, isPathGuarded: () => false }),
      ).toBe(adapterHandler);
      expect(await createFarmDocsAdapterHandler(docs, options)).toBe(adapterHandler);
      expect(() =>
        assertFarmDocsAdapterServesNoGuardedPages(resolved, { root, srcDir: "src" }, isPathGuarded),
      ).not.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
