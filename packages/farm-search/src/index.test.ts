import { beforeEach, describe, expect, it, vi } from "vitest";

const writeSearchIndex = vi.hoisted(() =>
  vi.fn(async () => ({
    bundlePath: "/docs/_farm/search/",
    outputPath: "/output/public/docs/_farm/search",
    indexedRoutes: ["/docs", "/docs/guide"],
    skippedRoutes: [],
  })),
);

vi.mock("./build", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./build")>()),
  writeSearchIndex,
}));

import { search } from "./index";

describe("search plugin", () => {
  beforeEach(() => {
    writeSearchIndex.mockClear();
  });

  it("uses Farm's basePath and indexes once after Nitro prerendering", async () => {
    const plugin = search({ include: ["/guide/**"] });
    const previous = vi.fn();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      await plugin.configure?.({ root: "/app", basePath: "/docs", plugins: [plugin] }, {} as never);
      expect(plugin.client?.public).toMatchObject({
        bundlePath: "/docs/_farm/search/",
        excerptLength: 30,
      });

      const configured = await plugin.build?.configure?.(
        {
          preset: "node-server",
          output: { dir: "/output", publicDir: "/output/public" },
          hooks: { "prerender:done": previous },
        },
        {} as never,
      );
      await configured.hooks["prerender:done"]({ prerenderedRoutes: [] });
      await plugin.build?.after?.(
        {
          root: "/app",
          preset: "node-server",
          outputDir: "/output",
          success: true,
        } as never,
        {} as never,
      );

      expect(previous).toHaveBeenCalledOnce();
      expect(writeSearchIndex).toHaveBeenCalledOnce();
      expect(writeSearchIndex).toHaveBeenCalledWith(
        expect.objectContaining({
          outputDir: "/output",
          publicDir: "/output/public",
          basePath: "/docs",
        }),
      );
      expect(info).toHaveBeenCalledWith(
        "[farm:search] Indexed 2 static pages at /docs/_farm/search/",
      );
    } finally {
      info.mockRestore();
    }
  });

  it("falls back to the final deployment output when Nitro has no prerender hook", async () => {
    const plugin = search();
    await plugin.configure?.({ root: "/app", plugins: [plugin] }, {} as never);
    await plugin.build?.after?.(
      {
        root: "/app",
        preset: "vercel",
        outputDir: "/output",
        success: true,
      } as never,
      {} as never,
    );

    expect(writeSearchIndex).toHaveBeenCalledWith(
      expect.objectContaining({ outputDir: "/output", preset: "vercel", basePath: "/" }),
    );
  });

  it("can generate again when the same plugin instance is used for another build", async () => {
    const plugin = search();
    await plugin.configure?.({ root: "/app", plugins: [plugin] }, {} as never);

    for (let build = 0; build < 2; build++) {
      await plugin.build?.before?.({} as never, {} as never);
      await plugin.build?.after?.(
        {
          root: "/app",
          preset: "node-server",
          outputDir: `/output-${build}`,
          success: true,
        } as never,
        {} as never,
      );
    }

    expect(writeSearchIndex).toHaveBeenCalledTimes(2);
  });

  it("rejects multiple search plugin instances", () => {
    const first = search();
    const second = search();
    expect(() =>
      first.configure?.({ root: "/app", plugins: [first, second] }, {} as never),
    ).toThrow("one search() plugin instance");
  });

  it("passes the resolved localized HTML prefix to both build paths", async () => {
    const plugin = search({ output: "app/search" });
    await plugin.configure?.(
      { root: "/project", basePath: "/app", i18n: { enabled: true }, plugins: [plugin] },
      {} as never,
    );
    expect(plugin.client?.public).toMatchObject({ bundlePath: "/app/app/search/" });
    const configured = await plugin.build?.configure?.(
      { preset: "node-server", output: { dir: "/output" } },
      {} as never,
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await configured.hooks["prerender:done"]({ prerenderedRoutes: [] });
      expect(writeSearchIndex).toHaveBeenLastCalledWith(
        expect.objectContaining({ htmlBasePath: "/app", basePath: "/app" }),
      );
      await plugin.build?.before?.({} as never, {} as never);
      await plugin.build?.after?.(
        { root: "/project", preset: "vercel", outputDir: "/output", success: true } as never,
        {} as never,
      );
      expect(writeSearchIndex).toHaveBeenLastCalledWith(
        expect.objectContaining({ htmlBasePath: "/app" }),
      );

      await plugin.build?.before?.({} as never, {} as never);
      await plugin.configure?.(
        { root: "/project", basePath: "/app", i18n: { enabled: false }, plugins: [plugin] },
        {} as never,
      );
      await plugin.build?.after?.(
        { root: "/project", preset: "node-server", outputDir: "/output", success: true } as never,
        {} as never,
      );
      expect(writeSearchIndex).toHaveBeenLastCalledWith(
        expect.objectContaining({ htmlBasePath: "/" }),
      );
    } finally {
      info.mockRestore();
    }
  });
});
