import {
  createProductionMiddlewareRunner,
  resolveFarmI18nConfig,
} from "@farm.js/core/internal/production-runtime";
import { describe, expect, it } from "vitest";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1_000_000 },
  deploymentId: "middleware-discovery",
  debug: false,
};

/**
 * Evaluate the generated entry's own file-middleware list against a set of
 * discovered modules, so these assertions exercise the code the RSC runtime
 * ships rather than a copy of it.
 */
function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return "";
  return source.slice(start, source.indexOf("\n}\n", start) + 2);
}

function buildMiddlewareModules(middlewares: Record<string, unknown>) {
  const entry = generateRscEntry(context);
  const start = entry.indexOf("modules: Object.entries(middlewares)");
  expect(start).toBeGreaterThan(-1);
  const end = entry.indexOf("\n  i18n:", start);
  const expression = entry.slice(start + "modules: ".length, end).replace(/,\s*$/, "");
  const helpers = [
    extractFunction(entry, "middlewarePathToRoute"),
    extractFunction(entry, "middlewareRouteDepth"),
  ].join("\n");
  return new Function("middlewares", `${helpers}\nreturn ${expression};`)(middlewares) as Array<{
    path: string;
    filePath: string;
    module: unknown;
  }>;
}

function recordingMiddleware(name: string, calls: string[]) {
  return {
    default: async (_ctx: unknown, next: () => Promise<void>) => {
      calls.push(name);
      await next();
    },
  };
}

describe("RSC file middleware discovery", () => {
  it("guards a route group's pages at their real URL", async () => {
    const calls: string[] = [];
    const modules = buildMiddlewareModules({
      "/(protected)/middleware.ts": recordingMiddleware("protected", calls),
    });
    expect(modules.map((entry) => entry.path)).toEqual(["/"]);

    // src/app/(protected)/dashboard/page.tsx renders at /dashboard, so the
    // group's middleware has to run there.
    const runner = createProductionMiddlewareRunner({ modules });
    await runner(new Request("https://example.test/dashboard"));
    expect(calls).toEqual(["protected"]);
  });

  it("drops groups inside a nested path", () => {
    const modules = buildMiddlewareModules({
      "/(shop)/cart/(checkout)/middleware.ts": { default: () => {} },
    });
    expect(modules.map((entry) => entry.path)).toEqual(["/cart"]);
  });

  it("drops parallel route slot folders, like core", () => {
    const modules = buildMiddlewareModules({
      "/dashboard/@team/middleware.ts": { default: () => {} },
      "/dashboard/@team/settings/middleware.ts": { default: () => {} },
    });
    expect(modules.map((entry) => entry.path)).toEqual(["/dashboard", "/dashboard/settings"]);
  });

  it("ignores middleware in private and dot folders, like core", () => {
    const modules = buildMiddlewareModules({
      "/_components/middleware.ts": { default: () => {} },
      "/dashboard/_lib/middleware.ts": { default: () => {} },
      "/.cache/middleware.ts": { default: () => {} },
      "/dashboard/middleware.ts": { default: () => {} },
    });
    expect(modules.map((entry) => entry.path)).toEqual(["/dashboard"]);
  });

  it("runs root middleware before nested middleware", async () => {
    const calls: string[] = [];
    // Glob keys arrive in path order, which puts /admin before the root.
    const modules = buildMiddlewareModules({
      "/admin/users/middleware.ts": recordingMiddleware("users", calls),
      "/admin/middleware.ts": recordingMiddleware("admin", calls),
      "/middleware.ts": recordingMiddleware("root", calls),
    });

    const runner = createProductionMiddlewareRunner({ modules });
    await runner(new Request("https://example.test/admin/users/7"));
    expect(calls).toEqual(["root", "admin", "users"]);
  });

  it("runs root middleware before route-group middleware at the same URL path", async () => {
    const calls: string[] = [];
    // Glob order puts '/(app)/' and '/(site)/' ahead of '/middleware.ts'.
    const modules = buildMiddlewareModules({
      "/(app)/middleware.ts": recordingMiddleware("app", calls),
      "/(site)/middleware.ts": recordingMiddleware("site", calls),
      "/middleware.ts": recordingMiddleware("root", calls),
    });
    expect(modules.map((entry) => entry.filePath)).toEqual([
      "/middleware.ts",
      "/(app)/middleware.ts",
      "/(site)/middleware.ts",
    ]);

    const runner = createProductionMiddlewareRunner({ modules });
    await runner(new Request("https://example.test/admin"));
    expect(calls).toEqual(["root", "app", "site"]);
  });
});

describe("RSC file middleware with api.basePath", () => {
  it("guards src/app/api routes at the public API path", async () => {
    const entry = generateRscEntry({ ...context, apiBasePath: "/v2/api" });
    expect(entry).toContain('const farmApiBasePath = "/v2/api";');
    // The entry hands its API path to the middleware runner it dispatches API routes with.
    expect(entry).toMatch(
      /createProductionMiddlewareRunner\(\{[\s\S]*?apiBasePath: farmApiBasePath,\n/,
    );

    const modules = buildMiddlewareModules({
      "/api/admin/middleware.ts": { default: () => new Response("no", { status: 401 }) },
    });
    const runner = createProductionMiddlewareRunner({ modules, apiBasePath: "/v2/api" });
    for (const url of ["/v2/api/admin/users", "/api/admin/users"]) {
      const result = await runner(new Request(`https://example.test${url}`));
      expect(result.response?.status, url).toBe(401);
    }
  });
});

describe("RSC file middleware under a basePath or locale prefix", () => {
  // RSC matchRoute() reads the request path as received, so pages under a basePath live in
  // app/<basePath>/ and locale pages in app/[lang]/. Their middleware has to run for them.
  async function blocked(
    i18n: ReturnType<typeof resolveFarmI18nConfig>,
    middlewares: Record<string, string>,
    url: string,
  ) {
    const entry = generateRscEntry({ ...context, i18n, basePath: i18n.basePath });
    expect(entry).toContain("rawPathRouting: true,");
    const calls: string[] = [];
    const modules = buildMiddlewareModules(
      Object.fromEntries(
        Object.entries(middlewares).map(([file, name]) => [
          file,
          {
            default() {
              calls.push(name);
              return new Response("no", { status: 401 });
            },
          },
        ]),
      ),
    );
    const runner = createProductionMiddlewareRunner({ modules, i18n, rawPathRouting: true });
    const result = await runner(new Request(`https://example.test${url}`));
    return { status: result.response?.status ?? null, calls };
  }

  const basePath = resolveFarmI18nConfig(false, {
    root: "/tmp",
    mode: "production",
    basePath: "/console",
  });
  const prefixed = resolveFarmI18nConfig(
    { locales: ["en", "de"], defaultLocale: "en", routing: "prefix" },
    { root: "/tmp", mode: "production", basePath: "/" },
  );

  it("guards app/<basePath>/ pages", async () => {
    await expect(
      blocked(basePath, { "/console/admin/middleware.ts": "nested" }, "/console/admin"),
    ).resolves.toEqual({ status: 401, calls: ["nested"] });
  });

  it("guards app/[lang]/ pages", async () => {
    await expect(
      blocked(prefixed, { "/[lang]/admin/middleware.ts": "locale" }, "/de/admin"),
    ).resolves.toEqual({ status: 401, calls: ["locale"] });
  });

  it("keeps guards that matched the stripped path", async () => {
    await expect(
      blocked(basePath, { "/admin/middleware.ts": "stripped" }, "/console/admin"),
    ).resolves.toEqual({ status: 401, calls: ["stripped"] });
    await expect(
      blocked(prefixed, { "/admin/middleware.ts": "stripped" }, "/de/admin"),
    ).resolves.toEqual({ status: 401, calls: ["stripped"] });
  });
});
