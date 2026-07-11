import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
        'import { defineFarmConfig } from "@farmjs/core";',
        "export default defineFarmConfig({",
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

    expect(result.routeTypesPath).toBe(routeTypesPath);
    expect(result.apiTypesPath).toBe(apiTypesPath);
    expect(result.envTypesPath).toBe(envTypesPath);
    expect(result.apiRoutes).toHaveLength(1);
    expect(existsSync(routeTypesPath)).toBe(true);
    expect(existsSync(apiTypesPath)).toBe(true);
    expect(existsSync(envTypesPath)).toBe(true);
    expect(readFileSync(routeTypesPath, "utf8")).toContain("`/users/${string}`");
    expect(readFileSync(routeTypesPath, "utf8")).toContain('"/users/[id]"');
    expect(readFileSync(routeTypesPath, "utf8")).toContain('"/docs/reference"');
    expect(readFileSync(apiTypesPath, "utf8")).toContain("hello: {");
    expect(readFileSync(apiTypesPath, "utf8")).toContain("post: typeof POST_hello;");
    expect(readFileSync(envTypesPath, "utf8")).toContain(
      'import type FarmConfig from "../farm.config"',
    );
    expect(readFileSync(envTypesPath, "utf8")).toContain('declare module "@farmjs/core/env"');
  });
});
