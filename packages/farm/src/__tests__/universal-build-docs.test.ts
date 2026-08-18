// @vitest-environment node

import { transform } from "esbuild";
import { describe, expect, it } from "vitest";
import type { FarmDocsResolvedConfig } from "../config";
import { generateFarmDocsRuntimeConfigExpression } from "../nitro/universal-build";

const docsConfig: FarmDocsResolvedConfig = {
  enabled: true,
  entry: "/docs",
  contentDir: "src/app/docs",
  configPath: "/workspace/docs/docs.config.ts",
  config: {
    entry: "docs",
    docsPath: "/docs",
    contentDir: "src/app/docs",
  },
};

describe("universal docs build", () => {
  it("emits one contentDir key per bundled docs config object", async () => {
    const expression = generateFarmDocsRuntimeConfigExpression(docsConfig);
    const transformed = await transform(
      `const farmDocsBundledContentDir = "/output/farm-docs-content"; const docs = ${expression};`,
      {
        loader: "js",
        logLevel: "silent",
      },
    );

    expect(transformed.warnings).toEqual([]);

    const resolveRuntimeConfig = new Function(
      "farmDocsBundledContentDir",
      `return ${expression};`,
    ) as (contentDir: string | null) => FarmDocsResolvedConfig;

    expect(resolveRuntimeConfig("/output/farm-docs-content")).toMatchObject({
      enabled: true,
      entry: "/docs",
      contentDir: "/output/farm-docs-content",
      configPath: "/workspace/docs/docs.config.ts",
      config: {
        entry: "docs",
        docsPath: "/docs",
        contentDir: "/output/farm-docs-content",
      },
    });
    expect(resolveRuntimeConfig(null)).toEqual(docsConfig);
  });

  it("disables the docs runtime without emitting a conditional object", () => {
    expect(
      generateFarmDocsRuntimeConfigExpression({
        enabled: false,
        entry: "/docs",
        config: { entry: "docs" },
      }),
    ).toBe("null");
  });
});
