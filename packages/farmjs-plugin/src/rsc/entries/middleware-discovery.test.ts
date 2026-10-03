import { createProductionMiddlewareRunner } from "@farm.js/core/internal/production-runtime";
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
});
