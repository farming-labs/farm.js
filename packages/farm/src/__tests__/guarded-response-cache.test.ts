// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import {
  _withFarmGuardedResponseCache,
  createProductionMiddlewareRunner,
} from "../middleware/production-runtime";
import { _farmPluginsKeepResponsesPrivate } from "../plugin-runtime-endpoint";
import type { FarmPlugin } from "../plugin";

// Middleware that lets a visitor through on something other than Cookie or Authorization (an
// IP allowlist, an API key header, a VPN header) used to leave Farm's shared cache policy on
// the response. A CDN keys its copy by URL and never runs the guard on a hit, so it served
// the guarded page to everyone. Any matched middleware now keeps the response private unless
// it declares `cache: "public"`.

const KEY = { "x-office-key": "k-123" };

const FARM_CONFIG = `
import { defineConfig } from "@farm.js/core";

// A headers route rule or headers() entry asking CDNs to cache everything under a path.
const SHARED_HEADERS = { "cache-control": "public, s-maxage=3600", "cdn-cache-control": "max-age=3600" };

const allowed = (ctx) => {
  const h = ctx.request.headers;
  return (typeof h.get === "function" ? h.get("x-office-key") : h["x-office-key"]) === "k-123";
};

export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  experimental: { ppr: true },
  md: { enabled: true },
  docs: { enabled: true },
  routeRules: {
    "/swr-guarded/**": { swr: 60 },
    "/swr-open": { swr: 60 },
    "/internal/ruled": { headers: SHARED_HEADERS },
    "/ruled": { headers: SHARED_HEADERS },
  },
  headers: () => [
    {
      source: "/internal/configured",
      headers: Object.entries(SHARED_HEADERS).map(([key, value]) => ({ key, value })),
    },
    {
      source: "/configured",
      headers: Object.entries(SHARED_HEADERS).map(([key, value]) => ({ key, value })),
    },
  ],
  middleware: [
    {
      // An API key header guard, as the docs suggest for an internal area.
      matcher: ["/internal/:path*", "/docs/internal", "/docs/internal.md"],
      handler(ctx) {
        if (!allowed(ctx)) return ctx.text("GUARD-BLOCKED", 403);
      },
    },
    {
      // Nitro's swr cache strips request headers before Farm runs, so this guard lets the
      // first visitor in and refuses everyone after.
      matcher: "/swr-guarded/:path*",
      handler(ctx) {
        globalThis.__farmSwrGuardCalls = (globalThis.__farmSwrGuardCalls || 0) + 1;
        if (globalThis.__farmSwrGuardCalls > 1) return ctx.text("GUARD-BLOCKED", 403);
      },
    },
    {
      // Logging decides nothing, so it opts back into shared caching.
      matcher: "/logged/:path*",
      cache: "public",
      handler() {},
    },
  ],
});
`;

const PAGES: Record<string, string> = {
  "src/app/layout.tsx":
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  "src/app/internal/ssg/page.tsx":
    "export const ssg = true;\nexport default function Page() { return <main>GUARDED-SSG</main>; }",
  "src/app/internal/report/page.tsx":
    "export const revalidate = 60;\nexport default function Page() { return <main>GUARDED-ISR</main>; }",
  "src/app/internal/shell/page.tsx":
    "export const experimental_ppr = true;\nexport default function Page() { return <main>GUARDED-PPR</main>; }",
  "src/app/swr-guarded/page.tsx":
    "export const ssg = true;\nexport default function Page() { return <main>GUARDED-SWR</main>; }",
  "src/app/swr-open/page.tsx": "export default function Page() { return <main>OPEN-SWR</main>; }",
  "src/app/internal/ruled/page.tsx":
    "export default function Page() { return <main>GUARDED-RULED</main>; }",
  "src/app/internal/configured/page.tsx":
    "export default function Page() { return <main>GUARDED-CONFIGURED</main>; }",
  "src/app/ruled/page.tsx": "export default function Page() { return <main>OPEN-RULED</main>; }",
  "src/app/configured/page.tsx":
    "export default function Page() { return <main>OPEN-CONFIGURED</main>; }",
  // A revalidate page: an ssg page no middleware matches is prerendered to a static file.
  "src/app/open/page.tsx":
    "export const revalidate = 60;\nexport default function Page() { return <main>OPEN-ISR</main>; }",
  "src/app/logged/page.tsx":
    "export const ssg = true;\nexport default function Page() { return <main>LOGGED-SSG</main>; }",
  "src/app/headers/middleware.ts": `
export const config = { cache: "public" };
export function middleware(_request, context) { context.headers.set("x-area", "headers"); }
`,
  "src/app/headers/page.tsx":
    "export const ssg = true;\nexport default function Page() { return <main>HEADERS-SSG</main>; }",
  "src/app/docs/page.md": "---\ntitle: Public docs\n---\n# Public docs\n\nPUBLIC-DOCS\n",
  "src/app/docs/internal/page.md":
    "---\ntitle: Internal runbook\n---\n# Internal runbook\n\nGUARDED-DOCS\n",
};

async function createFixture(
  config = FARM_CONFIG,
  pages: Record<string, string> = PAGES,
): Promise<string> {
  const packageRoot = process.cwd();
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-guarded-response-cache-"));
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
  await fs.writeFile(path.join(root, "farm.config.ts"), config);
  for (const [file, source] of Object.entries(pages)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return root;
}

describe("responses middleware let through", () => {
  it("stay out of shared caches in a production build unless the middleware opts in", async () => {
    const root = await createFixture();
    try {
      const config = await resolveConfig(
        { ...(await loadConfig(root, undefined, "production")), root },
        "production",
      );
      await build(config, { root, preset: "vercel" });
      const entry = path.join(root, ".vercel", "output", "functions", "__nitro.func", "index.mjs");
      const server = (await import(/* @vite-ignore */ pathToFileURL(entry).href)).default;
      const send = async (pathname: string, headers: Record<string, string> = {}) => {
        const response: Response = await server.fetch(
          new Request(`https://farm.test${pathname}`, { headers }),
        );
        return {
          status: response.status,
          cacheControl: response.headers.get("cache-control"),
          cdnCacheControl: response.headers.get("cdn-cache-control"),
          body: await response.text(),
        };
      };

      // The guard still decides: without the key, nothing renders.
      expect((await send("/internal/ssg")).status).toBe(403);

      // ssg, revalidate, and PPR pages, a docs page, and the Markdown forms of both.
      for (const [pathname, marker] of [
        ["/internal/ssg", "GUARDED-SSG"],
        ["/internal/report", "GUARDED-ISR"],
        ["/internal/shell", "GUARDED-PPR"],
        ["/internal/ssg.md", "GUARDED-SSG"],
        ["/docs/internal", "GUARDED-DOCS"],
        ["/docs/internal.md", "GUARDED-DOCS"],
      ] as const) {
        const response = await send(pathname, KEY);
        expect({ pathname, status: response.status, cache: response.cacheControl }).toEqual({
          pathname,
          status: 200,
          cache: "private, no-store",
        });
        expect(response.body).toContain(marker);
      }

      // Under a swr route rule Nitro writes its own public Cache-Control over the page's, so
      // a CDN kept the guarded page. It stays private, and Nitro's cache does not keep it
      // either: the next visitor meets the guard.
      const first = await send("/swr-guarded");
      expect(first).toMatchObject({ status: 200, cacheControl: "private, no-store" });
      expect(first.body).toContain("GUARDED-SWR");
      const second = await send("/swr-guarded");
      expect(second.status).toBe(403);
      expect(second.body).not.toContain("GUARDED-SWR");

      // A headers route rule (written by Nitro after Farm answered) or a headers() entry
      // (applied after the guard) asking CDNs to cache the path used to replace the private
      // policy, so a CDN served the guarded page to everyone.
      for (const [pathname, marker] of [
        ["/internal/ruled", "GUARDED-RULED"],
        ["/internal/configured", "GUARDED-CONFIGURED"],
      ] as const) {
        const response = await send(pathname, KEY);
        expect({ pathname, status: response.status, cache: response.cacheControl }).toEqual({
          pathname,
          status: 200,
          cache: "private, no-store",
        });
        expect(response.cdnCacheControl).toBeNull();
        expect(response.body).toContain(marker);
      }
      // Paths no middleware guards keep those headers as written.
      for (const pathname of ["/ruled", "/configured"]) {
        const response = await send(pathname);
        expect({ pathname, cache: response.cacheControl, cdn: response.cdnCacheControl }).toEqual({
          pathname,
          cache: "public, s-maxage=3600",
          cdn: "max-age=3600",
        });
      }

      // Pages no middleware matched keep their shared caching, as does a swr rule.
      const open = await send("/open");
      expect(open.body).toContain("OPEN-ISR");
      expect(open.cacheControl).toBe("public, s-maxage=60, stale-while-revalidate=300");
      const openDocs = await send("/docs");
      expect(openDocs.cacheControl).toBe("public, s-maxage=60, stale-while-revalidate=300");
      const openSwr = await send("/swr-open");
      expect(openSwr.cacheControl).toBe("public, max-age=60, s-maxage=60");

      // Middleware declaring cache: "public", in config or in a middleware file, opts back in.
      for (const pathname of ["/logged", "/headers"]) {
        const response = await send(pathname);
        expect({ pathname, cache: response.cacheControl }).toEqual({
          pathname,
          cache: "public, s-maxage=60, stale-while-revalidate=300",
        });
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 240_000);

  it("stay private under a headers route rule when no swr rule exists", async () => {
    // Nitro writes a headers rule after Farm answered. Farm's response hook used to be added
    // only for swr and cache rules, so on its own this rule made the guarded page public.
    const root = await createFixture(
      `
import { defineConfig } from "@farm.js/core";
export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  routeRules: {
    "/internal/**": { headers: { "cache-control": "public, s-maxage=3600", "cdn-cache-control": "max-age=3600" } },
  },
  middleware: [{ matcher: "/internal/:path*", handler() {} }],
});
`,
      {
        "src/app/layout.tsx": PAGES["src/app/layout.tsx"]!,
        "src/app/internal/ruled/page.tsx": PAGES["src/app/internal/ruled/page.tsx"]!,
      },
    );
    try {
      const config = await resolveConfig(
        { ...(await loadConfig(root, undefined, "production")), root },
        "production",
      );
      await build(config, { root, preset: "vercel" });
      const entry = path.join(root, ".vercel", "output", "functions", "__nitro.func", "index.mjs");
      const server = (await import(/* @vite-ignore */ pathToFileURL(entry).href)).default;
      const response: Response = await server.fetch(
        new Request("https://farm.test/internal/ruled"),
      );
      expect(await response.text()).toContain("GUARDED-RULED");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("cdn-cache-control")).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }, 240_000);

  it("are reported by the production middleware runner", async () => {
    const runner = createProductionMiddlewareRunner({
      config: [
        { matcher: "/guarded/:path*", handler: () => {} },
        { matcher: "/logged/:path*", cache: "public", handler: () => {} },
      ],
      modules: [
        {
          path: "/files",
          module: { config: { cache: "public" }, middleware: () => {} },
        },
      ],
    });
    const run = async (pathname: string) =>
      (await runner(new Request(`https://farm.test${pathname}`))).guarded;

    expect(await run("/guarded/a")).toBe(true);
    expect(await run("/logged/a")).toBe(false);
    expect(await run("/files/a")).toBe(false);
    expect(await run("/elsewhere")).toBe(false);
  });

  it("drop a shared policy and keep a private one", () => {
    const shared = _withFarmGuardedResponseCache(
      new Response("page", {
        headers: {
          "cache-control": "public, s-maxage=60",
          "cdn-cache-control": "max-age=60",
          "netlify-cdn-cache-control": "public, durable, max-age=60",
          "vercel-cdn-cache-control": "max-age=60",
        },
      }),
    );
    expect(shared.headers.get("cache-control")).toBe("private, no-store");
    expect(shared.headers.get("cdn-cache-control")).toBeNull();
    expect(shared.headers.get("netlify-cdn-cache-control")).toBeNull();
    expect(shared.headers.get("vercel-cdn-cache-control")).toBeNull();

    expect(_withFarmGuardedResponseCache(new Response("api")).headers.get("cache-control")).toBe(
      "private, no-store",
    );
    const browserCached = new Response("page", {
      headers: { "cache-control": "private, max-age=60" },
    });
    expect(_withFarmGuardedResponseCache(browserCached)).toBe(browserCached);
  });

  it("include those a plugin's runtime.before passed, unless it opts in", () => {
    const before = () => undefined;
    expect(_farmPluginsKeepResponsesPrivate([{ name: "guard", runtime: { before } }])).toBe(true);
    expect(
      _farmPluginsKeepResponsesPrivate([
        { name: "analytics", runtime: { cache: "public", before } },
        { name: "after-only", runtime: { after: () => undefined } },
      ] satisfies FarmPlugin[]),
    ).toBe(false);
  });
});
