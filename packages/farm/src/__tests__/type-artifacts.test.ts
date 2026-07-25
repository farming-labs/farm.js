import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateFarmTypeArtifacts } from "../type-artifacts";

describe("generateFarmTypeArtifacts", () => {
  it("generates route and API type files from the app tree", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-type-artifacts-"));
    const appDir = path.join(root, "src", "app");
    mkdirSync(path.join(appDir, "users", "[id]"), { recursive: true });
    mkdirSync(path.join(appDir, "api", "hello"), { recursive: true });

    writeFileSync(
      path.join(root, "farm.config.ts"),
      [
        'import { defineConfig } from "@farmjs/core";',
        "export default defineConfig({",
        "  env: {",
        "    server: { DATABASE_URL: { parse: (value: unknown) => String(value) } },",
        "    public: { PUBLIC_APP_URL: { parse: (value: unknown) => String(value) } },",
        "  },",
        "});",
      ].join("\n"),
    );
    writeFileSync(
      path.join(appDir, "page.tsx"),
      "export default function Home() { return null; }\n",
    );
    writeFileSync(
      path.join(appDir, "users", "[id]", "page.tsx"),
      "export default function User() { return null; }\n",
    );
    writeFileSync(
      path.join(appDir, "api", "hello", "route.ts"),
      "export const POST = async () => Response.json({ ok: true });\n",
    );

    const result = await generateFarmTypeArtifacts({
      root,
      srcDir: "src",
      extraRoutes: ["/docs/reference"],
    });

    const routeTypesPath = path.join(root, "src", "farm-routes.d.ts");
    const apiTypesPath = path.join(root, "src", "lib", "api.generated.ts");
    const envTypesPath = path.join(root, "src", "farm-env.d.ts");
    const imageTypesPath = path.join(root, "src", "farm-images.d.ts");

    expect(result.routeTypesPath).toBe(routeTypesPath);
    expect(result.apiTypesPath).toBe(apiTypesPath);
    expect(result.envTypesPath).toBe(envTypesPath);
    expect(result.imageTypesPath).toBe(imageTypesPath);
    expect(result.apiRoutes).toHaveLength(1);
    expect(existsSync(routeTypesPath)).toBe(true);
    expect(existsSync(apiTypesPath)).toBe(true);
    expect(existsSync(envTypesPath)).toBe(true);
    expect(existsSync(imageTypesPath)).toBe(true);
    expect(readFileSync(routeTypesPath, "utf8")).toContain("`/users/${string}`");
    expect(readFileSync(routeTypesPath, "utf8")).toContain('"/users/[id]"');
    expect(readFileSync(routeTypesPath, "utf8")).toContain('"/docs/reference"');
    expect(readFileSync(apiTypesPath, "utf8")).toContain("hello: {");
    expect(readFileSync(apiTypesPath, "utf8")).toContain("post: typeof POST_hello;");
    expect(readFileSync(envTypesPath, "utf8")).toContain(
      'import type FarmConfig from "../farm.config"',
    );
    expect(readFileSync(envTypesPath, "utf8")).toContain('declare module "@farmjs/core/env"');
    expect(readFileSync(imageTypesPath, "utf8")).toContain('declare module "*.png"');
    expect(readFileSync(imageTypesPath, "utf8")).toContain(
      'import("@farmjs/core/image").StaticImageData',
    );
    expect(readFileSync(imageTypesPath, "utf8")).toContain('declare module "*?url"');
  });

  it("generates one typed application from layer and project sources", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-layer-type-artifacts-"));
    const layerRoot = path.join(root, "layers", "commerce");
    const layerApp = path.join(layerRoot, "src", "app");
    const projectApp = path.join(root, "src", "app");
    mkdirSync(path.join(layerApp, "products", "[id]"), { recursive: true });
    mkdirSync(path.join(layerApp, "api", "inventory"), { recursive: true });
    mkdirSync(path.join(layerApp, "api", "catalog"), { recursive: true });
    mkdirSync(path.join(projectApp, "api", "catalog"), { recursive: true });

    writeFileSync(
      path.join(layerRoot, "farm.config.ts"),
      `export default {
        env: { server: { LAYER_TOKEN: { parse: (value: unknown) => String(value) } } }
      };\n`,
    );
    writeFileSync(
      path.join(root, "farm.config.ts"),
      `export default {
        extends: ["./layers/commerce"],
        env: { public: { PUBLIC_APP: { parse: (value: unknown) => String(value) } } }
      };\n`,
    );
    writeFileSync(
      path.join(layerApp, "products", "[id]", "page.tsx"),
      "export default function Product() { return null; }\n",
    );
    writeFileSync(
      path.join(layerRoot, "src", "routes.ts"),
      'export const ReportsRoute = createRoute("/reports", { component: () => null });\n',
    );
    writeFileSync(
      path.join(layerApp, "api", "inventory", "route.ts"),
      "export const GET = async () => Response.json({ ok: true });\n",
    );
    writeFileSync(
      path.join(layerApp, "api", "catalog", "route.ts"),
      "export const GET = async () => Response.json({ source: 'layer' });\n",
    );
    writeFileSync(
      path.join(projectApp, "api", "catalog", "route.ts"),
      "export const POST = async () => Response.json({ source: 'project' });\n",
    );

    const result = await generateFarmTypeArtifacts({
      root,
      layers: [
        {
          source: "./layers/commerce",
          name: "commerce",
          root: layerRoot,
          srcDir: "src",
          configFile: path.join(layerRoot, "farm.config.ts"),
        },
      ],
    });

    const routeTypes = readFileSync(result.routeTypesPath!, "utf8");
    const apiTypes = readFileSync(result.apiTypesPath!, "utf8");
    const envTypes = readFileSync(result.envTypesPath!, "utf8");

    expect(routeTypes).toContain("`/products/${string}`");
    expect(routeTypes).toContain('"/reports"');
    expect(result.apiRoutes.map((route) => [route.path, route.methods])).toEqual([
      ["/api/catalog", ["POST"]],
      ["/api/inventory", ["GET"]],
    ]);
    expect(apiTypes).toContain('from "../../layers/commerce/src/app/api/inventory/route"');
    expect(apiTypes).toContain('from "../app/api/catalog/route"');
    expect(envTypes).toContain('FarmConfig0 from "../layers/commerce/farm.config"');
    expect(envTypes).toContain('FarmConfig1 from "../farm.config"');
    expect(envTypes).toContain("type FarmMergedEnv1");
  });

  it("preserves unchanged outputs and refreshes changed API types", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "farm-incremental-type-artifacts-"));
    const apiRoutePath = path.join(root, "src", "app", "api", "hello", "route.ts");
    mkdirSync(path.dirname(apiRoutePath), { recursive: true });
    writeFileSync(apiRoutePath, "export const POST = async () => Response.json({ ok: true });\n");

    const first = await generateFarmTypeArtifacts({ root });
    const outputPaths = [
      first.routeTypesPath,
      first.apiTypesPath,
      first.envTypesPath,
      first.imageTypesPath,
    ].filter((filePath): filePath is string => Boolean(filePath));
    const historicalTime = new Date("2000-01-01T00:00:00.000Z");

    for (const filePath of outputPaths) {
      utimesSync(filePath, historicalTime, historicalTime);
    }
    const preservedMtimes = new Map(
      outputPaths.map((filePath) => [filePath, statSync(filePath).mtimeMs]),
    );

    await generateFarmTypeArtifacts({ root });

    for (const filePath of outputPaths) {
      expect(statSync(filePath).mtimeMs).toBe(preservedMtimes.get(filePath));
    }

    writeFileSync(
      apiRoutePath,
      [
        "export const GET = async () => Response.json({ ok: true });",
        "export const POST = async () => Response.json({ ok: true });",
        "",
      ].join("\n"),
    );
    await generateFarmTypeArtifacts({ root });

    expect(readFileSync(first.apiTypesPath!, "utf8")).toContain("get: typeof GET_hello;");
    expect(statSync(first.apiTypesPath!).mtimeMs).toBeGreaterThan(
      preservedMtimes.get(first.apiTypesPath!)!,
    );
    for (const filePath of outputPaths.filter((filePath) => filePath !== first.apiTypesPath)) {
      expect(statSync(filePath).mtimeMs).toBe(preservedMtimes.get(filePath));
    }
  });
});
