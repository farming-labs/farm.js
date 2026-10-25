import { describe, expect, it, vi } from "vitest";
import { generateRscEntry } from "./rsc.js";

function entry(development: boolean) {
  return generateRscEntry({
    srcDir: "src",
    outDir: "dist",
    basePath: "/",
    actionsEnabled: false,
    serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
    deploymentId: "isolation",
    debug: false,
    development,
  });
}

function globLines(code: string) {
  return code.split("\n").filter((line) => line.includes("import.meta.glob("));
}

/** The development loader and lookup, bound to the given route modules. */
function createDevLoader(routeModules: {
  pages: Record<string, unknown>;
  getRouteModules?: (pattern: string, modules: unknown, kind: string) => unknown[];
}) {
  const code = entry(true);
  const start = code.indexOf("const farmRouteLoadErrors = new Map();");
  const end = code.indexOf("// Auto-discover all route modules.", start);
  return new Function(
    "pages",
    "layouts",
    "loadings",
    "errors",
    "getRouteModules",
    `${code.slice(start, end)}; return { loadFarmDevRouteModules, findFarmRouteLoadError };`,
  )(routeModules.pages, {}, {}, {}, routeModules.getRouteModules ?? (() => [])) as {
    loadFarmDevRouteModules(
      loaders: Record<string, () => Promise<unknown>>,
    ): Promise<Record<string, { default: () => unknown }>>;
    findFarmRouteLoadError(matched: { pattern: string }): unknown;
  };
}

describe("RSC route module loading", () => {
  it("keeps production route globs eager", () => {
    const code = entry(false);
    const globs = globLines(code);
    expect(globs.length).toBeGreaterThan(0);
    for (const line of globs) expect(line).toContain("{ eager: true }");
    expect(code).not.toContain("loadFarmDevRouteModules");
    expect(code).not.toContain("farmRouteLoadErrors");
  });

  it("loads only page, layout, loading and error modules through the isolating loader in development", () => {
    const globs = globLines(entry(true));
    const isolated = globs.filter((line) => line.includes("loadFarmDevRouteModules("));
    expect(isolated.map((line) => line.match(/^const (\w+?)\d+ =/)?.[1])).toEqual([
      "pages",
      "layouts",
      "loadings",
      "errors",
    ]);
    // A broken middleware must keep failing every route rather than be skipped.
    for (const line of globs.filter((line) => !isolated.includes(line))) {
      expect(line).toContain("{ eager: true }");
    }
  });

  it("loads modules in order and replaces a failed one with a stub that rethrows", async () => {
    const failure = new Error("missing import");
    const { loadFarmDevRouteModules } = createDevLoader({ pages: {} });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];
    const modules = await loadFarmDevRouteModules({
      "/src/a/page.tsx": async () => (order.push("a"), { default: () => "a" }),
      "/src/broken/page.tsx": async () => {
        order.push("broken");
        throw failure;
      },
      "/src/c/page.tsx": async () => (order.push("c"), { default: () => "c" }),
    });
    consoleError.mockRestore();

    expect(order).toEqual(["a", "broken", "c"]);
    expect(Object.keys(modules)).toEqual([
      "/src/a/page.tsx",
      "/src/broken/page.tsx",
      "/src/c/page.tsx",
    ]);
    expect(modules["/src/c/page.tsx"]!.default()).toBe("c");
    expect(() => modules["/src/broken/page.tsx"]!.default()).toThrow(failure);
  });

  it("reports a load error only for routes that render the failed module", async () => {
    const pages: Record<string, unknown> = {};
    const layoutFailure = new Error("layout failed");
    let failedLayout: unknown;
    const dev = createDevLoader({
      pages,
      getRouteModules: (pattern, _modules, kind) =>
        kind === "layout" && pattern.startsWith("/admin/") ? [failedLayout] : [],
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.assign(
      pages,
      await dev.loadFarmDevRouteModules({
        "/page.tsx": async () => ({ default: () => "home" }),
        "/admin/page.tsx": async () => ({ default: () => "admin" }),
      }),
    );
    failedLayout = (
      await dev.loadFarmDevRouteModules({
        "/admin/layout.tsx": async () => {
          throw layoutFailure;
        },
      })
    )["/admin/layout.tsx"];
    consoleError.mockRestore();

    expect(dev.findFarmRouteLoadError({ pattern: "/page.tsx" })).toBeUndefined();
    expect(dev.findFarmRouteLoadError({ pattern: "/admin/page.tsx" })).toBe(layoutFailure);
  });
});
