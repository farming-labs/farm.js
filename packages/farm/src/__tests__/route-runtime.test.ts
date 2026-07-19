import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { APIRouteManager } from "../api/route-manager";
import {
  farmRouteRuleMatches,
  mergeFarmRouteRuntimeConfigs,
  normalizeFarmRouteRuntimeConfig,
  resolveFarmRouteRuleRuntimeConfig,
  resolveFarmRouteRuntimeConfig,
} from "../route-runtime";
import { createRoute, defineRoutes } from "../routes";
import { RouteManager } from "../routing/route-manager";
import type { FarmConfig } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("route runtime controls", () => {
  it("normalizes portable execution values and rejects unsafe input", () => {
    expect(
      normalizeFarmRouteRuntimeConfig({
        runtime: "edge",
        regions: [" iad1 ", "fra1", "iad1"],
        maxDuration: 30,
      }),
    ).toEqual({
      runtime: "edge",
      regions: ["iad1", "fra1"],
      maxDuration: 30,
    });

    expect(() => normalizeFarmRouteRuntimeConfig({ runtime: "worker" as any })).toThrow(
      'runtime must be "auto", "node", or "edge"',
    );
    expect(() => normalizeFarmRouteRuntimeConfig({ regions: [] })).toThrow("regions must be");
    expect(() => normalizeFarmRouteRuntimeConfig({ maxDuration: 1.5 })).toThrow("positive integer");
  });

  it("lets explicit auto values reset inherited regions and duration", () => {
    const merged = mergeFarmRouteRuntimeConfigs(
      { runtime: "edge", regions: ["fra1"], maxDuration: 60 },
      { runtime: "node", regions: "auto", maxDuration: "auto" },
    );

    expect(resolveFarmRouteRuntimeConfig(merged)).toEqual({ runtime: "node" });
  });

  it("merges broad route rules before specific rules", () => {
    const resolved = resolveFarmRouteRuleRuntimeConfig("/admin/reports", {
      "/**": { runtime: "edge", regions: ["iad1"] },
      "/admin/**": { runtime: "node", maxDuration: 60 },
      "/admin/reports": { regions: ["fra1"] },
    });

    expect(resolveFarmRouteRuntimeConfig(resolved)).toEqual({
      runtime: "node",
      regions: ["fra1"],
      maxDuration: 60,
    });
    expect(farmRouteRuleMatches("/products/**", "/products/[id]")).toBe(true);
    expect(farmRouteRuleMatches("/products/*", "/products/[id]/reviews")).toBe(false);
  });

  it("exposes typed controls on programmatic page, layout, and API routes", () => {
    const pageRoute = createRoute("/reports", {
      runtime: "edge",
      regions: ["iad1", "fra1"],
      maxDuration: 30,
      component: () => null,
    });
    const manifest = defineRoutes(({ layout, api }) => [
      layout("/", {
        runtime: "node",
        maxDuration: 60,
        component: ({ children }) => children,
      }),
      api("/api/reports", {
        runtime: "edge",
        regions: ["iad1"],
        GET: () => Response.json({ ok: true }),
      }),
    ]);

    expectTypeOf(pageRoute.runtime).toEqualTypeOf<"auto" | "node" | "edge" | undefined>();
    expect(pageRoute).toMatchObject({
      runtime: "edge",
      regions: ["iad1", "fra1"],
      maxDuration: 30,
    });
    expect(manifest.routes[0]).toMatchObject({ runtime: "node", maxDuration: 60 });
    expect(manifest.routes[1]).toMatchObject({ runtime: "edge", regions: ["iad1"] });
  });

  it("resolves route rules, layouts, and file page exports in precedence order", async () => {
    const root = createTempApp([
      "src/app/layout.tsx",
      "src/app/reports/layout.tsx",
      "src/app/reports/page.tsx",
    ]);
    const modules = new Map<string, Record<string, unknown>>([
      [
        path.join(root, "src/app/layout.tsx"),
        { default: ({ children }: any) => children, runtime: "edge", regions: ["fra1"] },
      ],
      [
        path.join(root, "src/app/reports/layout.tsx"),
        { default: ({ children }: any) => children, regions: "auto", maxDuration: 45 },
      ],
      [
        path.join(root, "src/app/reports/page.tsx"),
        { default: () => null, runtime: "node", maxDuration: 30 },
      ],
    ]);
    const manager = new RouteManager(
      createConfig(root, {
        "/reports": { runtime: "edge", regions: ["iad1"], maxDuration: 10 },
      }),
      createModuleServer(root, modules),
    );

    await manager.discoverRoutes();

    await expect(manager.resolveRouteRuntimeConfig("/reports")).resolves.toEqual({
      runtime: "node",
      maxDuration: 30,
    });
  });

  it("captures named exports from file API routes", async () => {
    const root = createTempApp(["src/app/api/reports/route.ts"]);
    const filePath = path.join(root, "src/app/api/reports/route.ts");
    const manager = new APIRouteManager(
      path.join(root, "src/app"),
      createModuleServer(
        root,
        new Map([
          [
            filePath,
            {
              runtime: "edge",
              regions: ["fra1"],
              maxDuration: 15,
              GET: () => Response.json({ ok: true }),
            },
          ],
        ]),
      ),
      { throwOnLoadError: true },
    );

    await manager.discoverRoutes();

    expect(manager.getRoutes().get("/api/reports")).toMatchObject({
      runtime: "edge",
      regions: ["fra1"],
      maxDuration: 15,
    });
  });
});

function createTempApp(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-route-runtime-"));
  tempDirs.push(root);
  for (const file of files) {
    const filePath = path.join(root, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "export default null;\n");
  }
  return root;
}

function createConfig(
  root: string,
  routeRules: FarmConfig["routeRules"] = {},
): Required<FarmConfig> {
  return {
    root,
    srcDir: "src",
    routeRules,
    mdx: { markdownRoutes: true, className: "farm-markdown" },
  } as Required<FarmConfig>;
}

function createModuleServer(root: string, modules: Map<string, Record<string, unknown>>) {
  return {
    config: { root },
    ssrLoadModule: async (filePath: string) => modules.get(filePath) || {},
  } as any;
}
