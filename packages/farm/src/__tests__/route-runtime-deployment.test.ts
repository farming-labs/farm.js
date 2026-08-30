import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { APIRouteManager } from "../api/route-manager";
import type { ResolvedFarmConfig } from "../config";
import {
  createFarmVercelRouteRuntimeFunctions,
  farmRoutePatternToVercelSource,
} from "../nitro/vercel-route-runtime";
import {
  createFarmRouteRuntimeManifest,
  validateFarmRouteRuntimeDeployment,
} from "../route-runtime-manifest";
import { getFarmPresetRuntime } from "../deployment";
import type { FarmRouteRuntimeManifest } from "../route-runtime";
import { RouteManager } from "../routing/route-manager";
import type { FarmConfig } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("route runtime deployment manifest", () => {
  it("collects inherited page controls, API exports, and unmatched rules", async () => {
    const root = createTempDir();
    const pagePath = writeFile(root, "src/app/reports/[id]/page.tsx");
    const layoutPath = writeFile(root, "src/app/reports/layout.tsx");
    const apiPath = writeFile(root, "src/app/api/reports/route.ts");
    const modules = new Map<string, Record<string, unknown>>([
      [layoutPath, { default: ({ children }: any) => children, regions: ["fra1"] }],
      [pagePath, { default: () => null, runtime: "node", maxDuration: 30 }],
      [
        apiPath,
        {
          runtime: "node",
          regions: ["iad1"],
          maxDuration: 15,
          GET: () => Response.json({ ok: true }),
        },
      ],
    ]);
    const routeRules = {
      "/reports/**": { runtime: "node" as const, maxDuration: 10 },
      "/internal/**": { runtime: "node" as const, regions: ["sfo1"] },
    };
    const config = createConfig(root, routeRules);
    const moduleServer = createModuleServer(root, modules);
    const routeManager = new RouteManager(config, moduleServer);
    const apiRouteManager = new APIRouteManager(path.join(root, "src/app"), moduleServer, {
      throwOnLoadError: true,
    });
    await routeManager.discoverRoutes();
    await apiRouteManager.discoverRoutes();

    const manifest = await createFarmRouteRuntimeManifest({
      config: config as ResolvedFarmConfig,
      routeManager,
      apiRouteManager,
      root,
    });

    expect(manifest).toMatchObject({
      version: 1,
      routes: expect.arrayContaining([
        expect.objectContaining({
          kind: "page",
          pattern: "/reports/[id]",
          runtime: "node",
          regions: ["fra1"],
          maxDuration: 30,
          rendering: "dynamic",
          source: "src/app/reports/[id]/page.tsx",
        }),
        expect.objectContaining({
          kind: "api",
          pattern: "/api/reports",
          runtime: "node",
          regions: ["iad1"],
          maxDuration: 15,
        }),
        expect.objectContaining({
          kind: "rule",
          pattern: "/internal/**",
          runtime: "node",
          regions: ["sfo1"],
        }),
      ]),
    });
  });

  it("publishes API runtime patterns at the configured local base path", async () => {
    const root = createTempDir();
    const apiPath = writeFile(root, "src/app/api/reports/[id]/route.ts");
    const modules = new Map<string, Record<string, unknown>>([
      [
        apiPath,
        {
          maxDuration: 15,
          GET: () => Response.json({ ok: true }),
        },
      ],
    ]);
    const config = createConfig(root, {
      "/v2/api/**": { maxDuration: 20 },
    });
    config.api = { baseURL: "/v2/api", basePath: "/v2/api" };
    const moduleServer = createModuleServer(root, modules);
    const routeManager = new RouteManager(config, moduleServer);
    const apiRouteManager = new APIRouteManager(path.join(root, "src/app"), moduleServer, {
      throwOnLoadError: true,
      basePath: "/v2/api",
    });
    await routeManager.discoverRoutes();
    await apiRouteManager.discoverRoutes();

    const manifest = await createFarmRouteRuntimeManifest({
      config: config as ResolvedFarmConfig,
      routeManager,
      apiRouteManager,
      root,
    });

    expect(manifest.routes).toContainEqual(
      expect.objectContaining({
        kind: "api",
        pattern: "/v2/api/reports/[id]",
        maxDuration: 15,
      }),
    );
  });

  it("rejects incompatible runtimes and reports unsupported provider hints", () => {
    const manifest: FarmRouteRuntimeManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          pattern: "/reports",
          rendering: "dynamic",
          runtime: "edge",
          regions: ["fra1"],
          maxDuration: 30,
        },
      ],
    };

    expect(() => validateFarmRouteRuntimeDeployment(manifest, "vercel")).toThrow(
      'Route "/reports" requires the edge runtime',
    );
    expect(validateFarmRouteRuntimeDeployment(manifest, "cloudflare-module")).toEqual({
      runtime: "edge",
      warnings: [
        expect.stringContaining("does not map per-route regions"),
        expect.stringContaining("does not map per-route maxDuration"),
      ],
    });
  });

  it("classifies self-hosted presets and warns when a custom runtime cannot be inferred", () => {
    expect(getFarmPresetRuntime("self-host")).toBe("node");
    expect(getFarmPresetRuntime("farm")).toBe("node");
    expect(getFarmPresetRuntime("custom")).toBe("unknown");

    const manifest: FarmRouteRuntimeManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          pattern: "/reports",
          rendering: "dynamic",
          runtime: "edge",
        },
      ],
    };

    expect(validateFarmRouteRuntimeDeployment(manifest, "custom")).toEqual({
      runtime: "unknown",
      warnings: [expect.stringContaining("could not verify")],
    });
  });
});

describe("Vercel route runtime output", () => {
  it("creates separately configured functions and keeps reset routes on the default function", async () => {
    const root = createTempDir();
    const outputDir = path.join(root, ".vercel/output");
    const baseFunction = path.join(outputDir, "functions/__nitro.func");
    fs.mkdirSync(baseFunction, { recursive: true });
    fs.writeFileSync(path.join(baseFunction, "index.mjs"), "export default {}\n");
    fs.writeFileSync(
      path.join(baseFunction, ".vc-config.json"),
      JSON.stringify({
        runtime: "nodejs22.x",
        handler: "index.mjs",
        launcherType: "Nodejs",
      }),
    );

    const manifest: FarmRouteRuntimeManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          pattern: "/reports",
          rendering: "dynamic",
          runtime: "node",
          regions: ["iad1"],
          maxDuration: 30,
        },
        {
          kind: "api",
          pattern: "/api/eu",
          rendering: "dynamic",
          runtime: "node",
          regions: ["fra1"],
          maxDuration: 15,
        },
        {
          kind: "page",
          pattern: "/products/[id]",
          rendering: "dynamic",
          runtime: "node",
        },
        {
          kind: "rule",
          pattern: "/admin/**",
          rendering: "dynamic",
          runtime: "node",
          regions: ["fra1"],
          maxDuration: 15,
        },
        {
          kind: "page",
          pattern: "/about",
          rendering: "static",
          runtime: "node",
          maxDuration: 5,
        },
      ],
    };

    const routes = await createFarmVercelRouteRuntimeFunctions(outputDir, manifest, fsPromises);

    expect(routes).toEqual([
      expect.objectContaining({ src: "/api/eu", dest: "/__farm_runtime_1" }),
      { src: "/products/([^/]+)", dest: "/__nitro" },
      { src: "/reports", dest: "/__farm_runtime_2" },
      { src: "/admin(?:/(.*))?", dest: "/__farm_runtime_1" },
    ]);

    await expect(readFunctionConfig(outputDir, "__farm_runtime_1")).resolves.toMatchObject({
      runtime: "nodejs22.x",
      regions: ["fra1"],
      maxDuration: 15,
    });
    await expect(readFunctionConfig(outputDir, "__farm_runtime_2")).resolves.toMatchObject({
      runtime: "nodejs22.x",
      regions: ["iad1"],
      maxDuration: 30,
    });
    await expect(readFunctionConfig(outputDir, "__nitro")).resolves.not.toHaveProperty(
      "maxDuration",
    );
  });

  it("converts static, dynamic, and catch-all Farm patterns", () => {
    expect(farmRoutePatternToVercelSource("/")).toBe("/");
    expect(farmRoutePatternToVercelSource("/products/[id]")).toBe("/products/([^/]+)");
    expect(farmRoutePatternToVercelSource("/docs/[...slug]")).toBe("/docs/(.+)");
    expect(farmRoutePatternToVercelSource("/docs/[[...slug]]")).toBe("/docs(?:/(.*))?");
    expect(farmRoutePatternToVercelSource("/api/**")).toBe("/api(?:/(.*))?");
  });
});

function createTempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-runtime-deploy-"));
  tempDirs.push(root);
  return root;
}

function writeFile(root: string, relativePath: string): string {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "export default null;\n");
  return filePath;
}

function createConfig(root: string, routeRules: FarmConfig["routeRules"]): Required<FarmConfig> {
  return {
    root,
    srcDir: "src",
    routeRules,
    api: { baseURL: "/api", basePath: "/api" },
    mdx: { markdownRoutes: true, className: "farm-markdown" },
  } as Required<FarmConfig>;
}

function createModuleServer(root: string, modules: Map<string, Record<string, unknown>>) {
  return {
    config: { root },
    ssrLoadModule: async (filePath: string) => modules.get(filePath) || {},
  } as any;
}

async function readFunctionConfig(outputDir: string, functionName: string) {
  const configPath = path.join(outputDir, "functions", `${functionName}.func`, ".vc-config.json");
  return JSON.parse(await fsPromises.readFile(configPath, "utf8"));
}
