// @vitest-environment node

import path from "node:path";
import { transform } from "esbuild";
import { describe, expect, it } from "vitest";
import type { FarmDocsResolvedConfig } from "../config";
import {
  generateClientHydrationEntry,
  generateFarmDocsAdapterHandlerArguments,
  generateFarmDocsRuntimeConfigExpression,
  getFarmAppOwnedDocsEnginePaths,
} from "../nitro/universal-build";
import { resolveFarmLlmsTxtConfig } from "../llms-txt";
import { resolveFarmAgentCrawlers } from "../agent-crawlers";

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

  it("leaves the unserializable runtime config out of the bundled JSON", () => {
    const expression = generateFarmDocsRuntimeConfigExpression({
      ...docsConfig,
      runtimeConfig: { ...docsConfig.config, icons: { book: { type: "svg" } as any } },
      configOverrides: { metadata: { description: "Docs" } },
    });
    expect(expression).not.toContain("runtimeConfig");
    expect(expression).toContain('"configOverrides":{"metadata":{"description":"Docs"}}');
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

  describe("with several docs roots", () => {
    const multiRootDocs: FarmDocsResolvedConfig = {
      ...docsConfig,
      configOverrides: { nav: { title: "Farm" } },
      roots: [
        {
          entry: "/statewire/docs",
          contentDir: "src/app/statewire/docs",
          config: {
            entry: "statewire/docs",
            docsPath: "/statewire/docs",
            contentDir: "src/app/statewire/docs",
            nav: { title: "Statewire" },
          },
          runtimeConfig: { entry: "statewire/docs", icons: { book: { type: "svg" } as any } },
          configOverrides: { nav: { title: "Statewire" } },
        },
        {
          entry: "/pinboard/docs",
          contentDir: "content/pinboard",
          config: {
            entry: "pinboard/docs",
            docsPath: "/pinboard/docs",
            contentDir: "content/pinboard",
          },
          configOverrides: { nav: { title: "Farm" } },
        },
      ],
    };

    function resolveAdapterConfigs(
      bundled: { main: string | null; roots: string | null; existing: string[] },
      configModule?: Record<string, unknown>,
    ) {
      const expression = generateFarmDocsRuntimeConfigExpression(multiRootDocs);
      const handler = generateFarmDocsAdapterHandlerArguments(
        multiRootDocs,
        configModule ? "/workspace/docs/docs.config.ts" : undefined,
      );
      expect(handler.factory).toBe("createFarmDocsAdapterMultiRuntimeHandler");
      return new Function(
        "farmDocsBundledContentDir",
        "farmDocsBundledRootsDir",
        "farmDocsJoin",
        "farmDocsExistsSync",
        "farmDocsConfigModule",
        `const farmDocsResolvedConfig = ${expression}; return ${handler.config};`,
      )(
        bundled.main,
        bundled.roots,
        path.posix.join,
        (candidate: string) => bundled.existing.includes(candidate),
        configModule,
      ) as Record<string, unknown>[];
    }

    it("hands the adapter one runtime config per root, main root first", () => {
      expect(resolveAdapterConfigs({ main: null, roots: null, existing: [] })).toEqual([
        { ...docsConfig.config, entry: "docs", docsPath: "/docs", contentDir: "src/app/docs" },
        {
          entry: "statewire/docs",
          docsPath: "/statewire/docs",
          contentDir: "src/app/statewire/docs",
          nav: { title: "Statewire" },
        },
        { entry: "pinboard/docs", docsPath: "/pinboard/docs", contentDir: "content/pinboard" },
      ]);
      // The config module carries what JSON cannot; each root's own overrides apply over it.
      expect(
        resolveAdapterConfigs({ main: null, roots: null, existing: [] }, { search: true }).map(
          ({ search, nav, docsPath }) => ({ search, nav, docsPath }),
        ),
      ).toEqual([
        { search: true, nav: { title: "Farm" }, docsPath: "/docs" },
        { search: true, nav: { title: "Statewire" }, docsPath: "/statewire/docs" },
        { search: true, nav: { title: "Farm" }, docsPath: "/pinboard/docs" },
      ]);
    });

    it("reads each root's content from its own bundled directory", () => {
      const configs = resolveAdapterConfigs({
        main: "/fn/farm-docs-content",
        roots: "/fn/farm-docs-roots",
        // The second root has no bundled copy, so it keeps its configured directory.
        existing: ["/fn/farm-docs-roots/0"],
      });
      expect(configs.map((config) => config.contentDir)).toEqual([
        "/fn/farm-docs-content",
        "/fn/farm-docs-roots/0",
        "content/pinboard",
      ]);
    });

    it("leaves every root's unserializable runtime config out of the bundled JSON", () => {
      expect(generateFarmDocsRuntimeConfigExpression(multiRootDocs)).not.toContain("runtimeConfig");
    });

    it("keeps the single-root adapter call", () => {
      const handler = generateFarmDocsAdapterHandlerArguments(docsConfig, undefined);
      expect(handler.factory).toBe("createFarmDocsAdapterRuntimeHandler");
      const config = new Function("farmDocsResolvedConfig", `return ${handler.config};`)(
        docsConfig,
      );
      expect(config).toEqual({
        ...docsConfig.config,
        entry: "docs",
        docsPath: "/docs",
        contentDir: "src/app/docs",
      });
      expect(generateFarmDocsRuntimeConfigExpression(docsConfig)).not.toContain(
        "farmDocsBundledRootsDir",
      );
    });

    function generateClientEntry(docsEntryPath: string | string[]) {
      return generateClientHydrationEntry(
        [],
        [],
        [],
        "/app",
        "src",
        false,
        undefined,
        docsEntryPath,
        undefined,
      );
    }

    it("leaves every root's pages to document navigation in the client", () => {
      const source = generateClientEntry(["/docs", "/statewire/docs", "/pinboard/docs"]);
      const start = source.indexOf("const farmDocsEntryPaths");
      const end = source.indexOf("\n}\n", source.indexOf("function isFarmDocsPath", start));
      const isFarmDocsPath = new Function(
        "getFarmRoutePathname",
        `${source.slice(start, end + 2)}\nreturn isFarmDocsPath;`,
      )((pathname: string) => pathname) as (pathname: string) => boolean;

      for (const pathname of ["/docs", "/statewire/docs/", "/pinboard/docs/guide"]) {
        expect(isFarmDocsPath(pathname)).toBe(true);
      }
      for (const pathname of ["/statewire", "/pinboard/docsearch", "/about"]) {
        expect(isFarmDocsPath(pathname)).toBe(false);
      }
      // A single docs root keeps the client entry it had before docs.roots.
      expect(generateClientEntry(["/docs"])).toBe(generateClientEntry("/docs"));
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

  it("hands the app /robots.txt when agent.crawlers generates it", () => {
    const llmsOff = { llmsTxt: resolveFarmLlmsTxtConfig(undefined) };
    expect(
      getFarmAppOwnedDocsEnginePaths({ ...llmsOff, crawlers: resolveFarmAgentCrawlers(true) }, []),
    ).toEqual(["/robots.txt"]);
    expect(
      getFarmAppOwnedDocsEnginePaths(
        { ...llmsOff, crawlers: resolveFarmAgentCrawlers(undefined) },
        [],
      ),
    ).toEqual([]);
  });
});
