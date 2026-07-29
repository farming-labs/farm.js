import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertRscPackageCompatibility } from "./compatibility.js";
import farmRsc, { defineConfig } from "./index.js";

const EXPECTED_PACKAGES = {
  react: "19.2.8",
  "react-dom": "19.2.8",
  "react-server-dom-webpack": "19.2.8",
  "@vitejs/plugin-rsc": "0.5.32",
} as const;

const temporaryRoots: string[] = [];

function createProject(packages: Partial<Record<keyof typeof EXPECTED_PACKAGES, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-compatibility-"));
  temporaryRoots.push(root);

  for (const [packageName, version] of Object.entries(packages)) {
    const packageRoot = path.join(root, "node_modules", packageName);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: packageName, version }),
    );
  }

  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("RSC package compatibility", () => {
  it("accepts the exact supported package set", () => {
    const root = createProject(EXPECTED_PACKAGES);
    expect(() => assertRscPackageCompatibility(root)).not.toThrow();
  });

  it("rejects vulnerable or missing RSC packages with an actionable message", () => {
    const root = createProject({
      react: "19.2.4",
      "react-dom": "19.2.4",
      "react-server-dom-webpack": "19.2.4",
      "@vitejs/plugin-rsc": "0.5.18",
    });

    expect(() => assertRscPackageCompatibility(root)).toThrowError(
      /react: expected 19\.2\.8, found 19\.2\.4[\s\S]*react-server-dom-webpack: expected 19\.2\.8, found 19\.2\.4[\s\S]*@vitejs\/plugin-rsc: expected 0\.5\.32, found 0\.5\.18/,
    );
  });

  it("keeps Server Actions disabled until an RSC application opts in", () => {
    const config = defineConfig();
    expect(config.experimental).toEqual({
      serverComponents: true,
      serverActions: false,
      optimizedBoundary: false,
    });
  });

  it("does not require the RSC package set when RSC is disabled", async () => {
    const root = createProject({});
    const configPlugin = farmRsc().find((plugin) => plugin.name === "@farm.js/plugin/rsc:config");
    const configHook = configPlugin?.config as (
      config: Record<string, unknown>,
      env: { command: "build"; mode: string },
    ) => Promise<unknown>;

    await expect(
      configHook(
        {
          root,
          experimental: { serverComponents: false },
        },
        { command: "build", mode: "production" },
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps the package manifest and ordinary core dependency graph aligned", () => {
    const pluginManifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      devDependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
    };
    const coreManifest = JSON.parse(
      readFileSync(new URL("../../../farm/package.json", import.meta.url), "utf8"),
    ) as {
      dependencies: Record<string, string>;
    };

    for (const [packageName, version] of Object.entries(EXPECTED_PACKAGES)) {
      expect(pluginManifest.devDependencies[packageName]).toBe(version);
      expect(pluginManifest.peerDependencies[packageName]).toBe(version);
    }
    expect(coreManifest.dependencies).not.toHaveProperty("react-server-dom-webpack");
  });
});
