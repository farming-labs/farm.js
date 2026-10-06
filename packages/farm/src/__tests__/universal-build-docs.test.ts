// @vitest-environment node

import { transform } from "esbuild";
import { describe, expect, it } from "vitest";
import type { FarmDocsResolvedConfig } from "../config";
import {
  generateFarmDocsRuntimeConfigExpression,
  getFarmAppOwnedDocsEnginePaths,
} from "../nitro/universal-build";
import { resolveFarmLlmsTxtConfig } from "../llms-txt";

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

  it("removes build-machine paths from precompiled edge config", () => {
    const expression = generateFarmDocsRuntimeConfigExpression(docsConfig, true);
    expect(expression).not.toContain("/workspace/docs");
    expect(expression).not.toContain("src/app/docs");
    expect(JSON.parse(expression)).toMatchObject({
      enabled: true,
      entry: "/docs",
      config: { entry: "docs", docsPath: "/docs" },
    });
  });

  it("leaves the docs engine every root file the app does not serve itself", () => {
    const llmsOff = { llmsTxt: resolveFarmLlmsTxtConfig(undefined) };
    expect(getFarmAppOwnedDocsEnginePaths(llmsOff, [])).toEqual([]);
    // Nested metadata routes do not answer the docs engine's root paths.
    expect(
      getFarmAppOwnedDocsEnginePaths(llmsOff, [
        { kind: "sitemap", pattern: "/blog" },
        { kind: "robots", pattern: "/blog" },
      ]),
    ).toEqual([]);
    // The manifest is not a docs engine path.
    expect(getFarmAppOwnedDocsEnginePaths(llmsOff, [{ kind: "manifest", pattern: "/" }])).toEqual(
      [],
    );
  });

  it("hands the app the root files it serves itself", () => {
    const llmsOff = { llmsTxt: resolveFarmLlmsTxtConfig(undefined) };
    expect(getFarmAppOwnedDocsEnginePaths(llmsOff, [{ kind: "sitemap", pattern: "/" }])).toEqual([
      "/sitemap.xml",
    ]);
    expect(getFarmAppOwnedDocsEnginePaths(llmsOff, [{ kind: "robots", pattern: "/" }])).toEqual([
      "/robots.txt",
    ]);
    expect(
      getFarmAppOwnedDocsEnginePaths({ llmsTxt: resolveFarmLlmsTxtConfig(true) }, [
        { kind: "sitemap", pattern: "/" },
        { kind: "robots", pattern: "/" },
      ]),
    ).toEqual(["/llms.txt", "/llms-full.txt", "/sitemap.xml", "/robots.txt"]);
    expect(
      getFarmAppOwnedDocsEnginePaths(llmsOff, [
        { kind: "llms", pattern: "/" },
        { kind: "llms-full", pattern: "/" },
      ]),
    ).toEqual(["/llms.txt", "/llms-full.txt"]);
  });
});
