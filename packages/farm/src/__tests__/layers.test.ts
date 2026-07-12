// @vitest-environment node

import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APIRouteManager } from "../api/route-manager";
import { loadConfig, resolveConfig } from "../config";
import {
  getFarmAppDirectories,
  getFarmLayerAliases,
  getFarmSourceRoots,
  resolveFarmLayers,
} from "../layers";
import { MiddlewareManager } from "../middleware/manager";
import { discoverMiddlewareRoutes } from "../nitro/universal-build";
import { RouteManager } from "../routing/route-manager";
import { farmPlugin } from "../vite";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Farm layers", () => {
  it("consumes layers directly from an application's farm.config.ts", async () => {
    const root = createProject();
    createLayer(root, "commerce", {
      config: `export default { routeRules: { "/shop/**": { swr: 120 } } };`,
    });
    writeFileSync(
      path.join(root, "farm.config.ts"),
      `
        import { defineFarmConfig } from "@farmjs/core";
        export default defineFarmConfig({
          extends: ["./layers/commerce"],
          routeRules: { "/shop/checkout": { render: "dynamic" } }
        });
      `,
    );

    const userConfig = await loadConfig(root, undefined, "development");
    const config = await resolveConfig(userConfig!, "development");

    expect(config.layers.map((layer) => layer.name)).toEqual(["commerce"]);
    expect(config.routeRules).toMatchObject({
      "/shop/**": { swr: 120 },
      "/shop/checkout": { render: "dynamic" },
    });
  });

  it("loads ordinary local Farm directories and applies project overrides", async () => {
    const root = createProject();
    createLayer(root, "base", {
      config: `
        export default {
          basePath: "/base",
          experimental: { serverComponents: true },
          routeRules: { "/shared/**": { swr: 60 } },
          plugins: [{ name: "base-plugin" }],
          middleware: { handler() {} },
          serverActions: { bodySizeLimit: "500kb" },
          outDir: "layer-dist"
        };
      `,
    });
    createLayer(root, "admin", {
      config: `
        export default {
          routeRules: {
            "/shared/**": { render: "dynamic" },
            "/admin/**": { render: "dynamic" }
          },
          plugins: [{ name: "admin-plugin" }],
          middleware: { handler() {} },
          serverActions: { bodySizeLimit: "750kb" }
        };
      `,
    });

    const resolved = await resolveConfig(
      {
        root,
        extends: ["./layers/base", "./layers/admin"],
        basePath: "/project",
        plugins: [{ name: "project-plugin" }],
        serverActions: { bodySizeLimit: "1mb" },
      },
      "development",
    );

    expect(resolved.layers.map((layer) => layer.name)).toEqual(["base", "admin"]);
    expect(resolved.basePath).toBe("/project");
    expect(resolved.outDir).toBe("dist");
    expect(resolved.experimental.serverComponents).toBe(true);
    expect(resolved.routeRules["/shared/**"]).toMatchObject({
      swr: 60,
      render: "dynamic",
    });
    expect(resolved.routeRules["/admin/**"]).toMatchObject({ render: "dynamic" });
    expect(resolved.plugins.map((plugin) => plugin.name)).toEqual([
      "base-plugin",
      "admin-plugin",
      "project-plugin",
    ]);
    expect(Array.isArray(resolved.middleware)).toBe(true);
    expect(resolved.serverActions.bodySizeLimit).toBe(1_000_000);
  });

  it("supports nested extends and resolves them relative to the declaring layer", async () => {
    const root = createProject();
    createLayer(root, "foundation", {
      config: `export default { routeRules: { "/foundation": { prerender: true } } };`,
    });
    createLayer(root, "commerce", {
      config: `
        export default {
          extends: ["../foundation"],
          routeRules: { "/shop": { render: "dynamic" } }
        };
      `,
    });

    const resolution = await resolveFarmLayers(
      { root, extends: ["./layers/commerce"] },
      { root, mode: "development" },
    );

    expect(resolution.layers.map((layer) => layer.name)).toEqual(["foundation", "commerce"]);
    expect(resolution.config.routeRules).toMatchObject({
      "/foundation": { prerender: true },
      "/shop": { render: "dynamic" },
    });
  });

  it("loads installed package layers without package-specific Farm metadata", async () => {
    const root = createProject();
    const packageRoot = path.join(root, "node_modules", "@company", "admin-layer");
    mkdirSync(path.join(packageRoot, "src", "app", "admin"), { recursive: true });
    writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@company/admin-layer",
        version: "1.0.0",
        exports: { ".": "./index.js" },
      }),
    );
    writeFileSync(path.join(packageRoot, "index.js"), "export {};\n");
    const helperRoot = path.join(packageRoot, "node_modules", "layer-helper");
    mkdirSync(helperRoot, { recursive: true });
    writeFileSync(
      path.join(helperRoot, "package.json"),
      JSON.stringify({ name: "layer-helper", version: "1.0.0", type: "module", main: "index.js" }),
    );
    writeFileSync(path.join(helperRoot, "index.js"), "export const adminSWR = 180;\n");
    writeFileSync(
      path.join(packageRoot, "farm.config.js"),
      `import { adminSWR } from "layer-helper";
       export default { routeRules: { "/admin/**": { render: "dynamic", swr: adminSWR } } };\n`,
    );
    writeFileSync(
      path.join(packageRoot, "src", "app", "admin", "page.tsx"),
      "export default function Admin() { return null; }\n",
    );

    const resolution = await resolveFarmLayers(
      { root, extends: ["@company/admin-layer"] },
      { root, mode: "development" },
    );

    expect(resolution.layers).toEqual([
      expect.objectContaining({
        source: "@company/admin-layer",
        name: "admin-layer",
        root: packageRoot,
        srcDir: "src",
      }),
    ]);
    expect(resolution.config.routeRules["/admin/**"]).toMatchObject({
      render: "dynamic",
      swr: 180,
    });
  });

  it("exposes ordered source roots, app directories, and automatic aliases", async () => {
    const root = createProject();
    const commerceRoot = createLayer(root, "commerce");
    const resolution = await resolveFarmLayers(
      { root, srcDir: "source", extends: ["./layers/commerce"] },
      { root, mode: "development" },
    );

    expect(getFarmSourceRoots(resolution.config)).toEqual([
      { name: "commerce", root: commerceRoot, srcDir: "src", layer: true },
      { name: "project", root, srcDir: "source", layer: false },
    ]);
    expect(getFarmAppDirectories(resolution.config)).toEqual([
      path.join(commerceRoot, "src", "app"),
      path.join(root, "source", "app"),
    ]);
    expect(getFarmLayerAliases(resolution.layers)).toEqual({
      "#layers/commerce": path.join(commerceRoot, "src"),
    });
  });

  it("rejects recursive layers with a useful cycle", async () => {
    const root = createProject();
    createLayer(root, "a", { config: `export default { extends: ["../b"] };` });
    createLayer(root, "b", { config: `export default { extends: ["../a"] };` });

    await expect(
      resolveFarmLayers({ root, extends: ["./layers/a"] }, { root, mode: "development" }),
    ).rejects.toThrow("./layers/a -> ../b -> ../a");
  });

  it("rejects invalid layer entries and layer srcDir escapes", async () => {
    const root = createProject();
    createLayer(root, "unsafe", { config: `export default { srcDir: "../outside" };` });

    await expect(
      resolveFarmLayers({ root, extends: ["./layers/unsafe"] }, { root, mode: "development" }),
    ).rejects.toThrow("cannot leave the layer root");

    await expect(
      resolveFarmLayers({ root, extends: [""] }, { root, mode: "development" }),
    ).rejects.toThrow("must be a non-empty string");
  });

  it("discovers inherited routes and lets project files replace matching layer files", async () => {
    const root = createProject();
    const baseRoot = createLayer(root, "base");
    writeSource(baseRoot, "src/app/layout.tsx");
    writeSource(baseRoot, "src/app/products/page.tsx");
    writeSource(baseRoot, "src/app/admin/page.tsx");
    writeSource(baseRoot, "src/app/products/loading.tsx");
    writeSource(root, "src/app/products/page.tsx");

    const config = await resolveConfig({ root, extends: ["./layers/base"] }, "development");
    const manager = new RouteManager(config as any);
    await manager.discoverRoutes();

    expect(manager.getRoutes().get("/products")?.modulePath).toBe(
      path.join(root, "src/app/products/page.tsx"),
    );
    expect(manager.getRoutes().get("/admin")?.modulePath).toBe(
      path.join(baseRoot, "src/app/admin/page.tsx"),
    );
    expect(manager.getLayouts().get("/")?.modulePath).toBe(
      path.join(baseRoot, "src/app/layout.tsx"),
    );
    expect(manager.getLoadings().get("/products")?.modulePath).toBe(
      path.join(baseRoot, "src/app/products/loading.tsx"),
    );
    expect(
      manager.generateClientManifest(root).routes.find((route) => route.pattern === "/admin")
        ?.modulePath,
    ).toBe("/layers/base/src/app/admin/page.tsx");
  });

  it("applies the same precedence to APIs and filesystem middleware", async () => {
    const root = createProject();
    const baseRoot = createLayer(root, "base");
    writeSource(baseRoot, "src/app/api/catalog/route.ts");
    writeSource(baseRoot, "src/app/api/admin/route.ts");
    writeSource(root, "src/app/api/catalog/route.ts");
    writeSource(baseRoot, "src/app/middleware.ts");
    writeSource(baseRoot, "src/app/admin/middleware.ts");
    writeSource(root, "src/app/middleware.ts");

    const config = await resolveConfig({ root, extends: ["./layers/base"] }, "development");
    const loadModule = async (filePath: string) => ({
      GET: () => new Response(filePath.startsWith(path.join(root, "src")) ? "project" : "layer"),
      default: Object.assign(async () => undefined, { filePath }),
    });
    const vite = { ssrLoadModule: loadModule } as any;
    const appDirs = getFarmAppDirectories(config);

    const apiManager = new APIRouteManager(appDirs, vite);
    await apiManager.discoverRoutes();
    expect(
      await (await apiManager.getHandler()!(new Request("http://farm.test/api/catalog"))).text(),
    ).toBe("project");
    expect(
      await (await apiManager.getHandler()!(new Request("http://farm.test/api/admin"))).text(),
    ).toBe("layer");

    const middlewareManager = new MiddlewareManager(appDirs, vite);
    await middlewareManager.discover();
    const middleware = middlewareManager.getMiddlewares();
    expect(middleware.find((entry) => entry.path === "/")?.filePath).toBe(
      path.join(root, "src/app/middleware.ts"),
    );
    expect(middleware.find((entry) => entry.path === "/admin")?.filePath).toBe(
      path.join(baseRoot, "src/app/admin/middleware.ts"),
    );

    expect(await discoverMiddlewareRoutes(appDirs)).toEqual([
      { path: "/", filePath: path.join(root, "src/app/middleware.ts") },
      { path: "/admin", filePath: path.join(baseRoot, "src/app/admin/middleware.ts") },
    ]);
  });

  it("lets a project programmatic route override a layer programmatic route", async () => {
    const root = createProject();
    const baseRoot = createLayer(root, "base");
    const layerRoutes = writeSource(baseRoot, "src/routes.ts");
    const projectRoutes = writeSource(root, "src/routes.ts");
    const component = () => null;
    const vite = {
      async ssrLoadModule(filePath: string) {
        return {
          default: {
            __farmRoutes: true,
            routes: [{ kind: "page", path: "/reports", component, metadata: { filePath } }],
          },
        };
      },
    } as any;
    const config = await resolveConfig({ root, extends: ["./layers/base"] }, "development");
    const manager = new RouteManager(config as any, vite);

    await manager.discoverRoutes();

    expect(manager.getRoutes().get("/reports")?.modulePath).toContain(projectRoutes);
    expect(manager.getRoutes().get("/reports")?.modulePath).not.toContain(layerRoutes);
  });

  it("registers layer aliases and filesystem access with Vite", async () => {
    const root = createProject();
    const layerRoot = createLayer(root, "commerce");
    const plugin = farmPlugin({
      root,
      layers: [
        {
          source: "./layers/commerce",
          name: "commerce",
          root: layerRoot,
          srcDir: "src",
        },
      ],
    });
    const configHook = plugin.config as (...args: any[]) => any;

    const viteConfig = await configHook({}, { command: "serve", mode: "development" });

    expect(viteConfig.resolve.alias).toEqual({
      "#layers/commerce": path.join(layerRoot, "src"),
    });
    expect(viteConfig.server.fs.allow).toEqual([root, layerRoot]);
  });
});

function createProject(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "farm-layers-")));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "src", "app"), { recursive: true });
  return root;
}

function createLayer(projectRoot: string, name: string, options: { config?: string } = {}): string {
  const root = path.join(projectRoot, "layers", name);
  mkdirSync(path.join(root, "src", "app"), { recursive: true });
  if (options.config) {
    writeFileSync(path.join(root, "farm.config.ts"), options.config);
  }
  return root;
}

function writeSource(root: string, relativePath: string): string {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "export default function LayerFixture() { return null; }\n");
  return filePath;
}
