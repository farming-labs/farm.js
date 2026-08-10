// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createFarmDocsAdapterHandler, hasFarmDocsRuntimeAdapter } from "../docs/adapter";
import type { FarmDocsResolvedConfig } from "../docs/types";

function createAdapterDocs(): FarmDocsResolvedConfig {
  return {
    enabled: true,
    entry: "/docs",
    contentDir: "content/docs",
    adapter: {
      id: "@farming-labs/farmjs",
      protocol: 1,
      server: "@farming-labs/farmjs/server",
      react: "@farming-labs/farmjs/react",
    },
    config: { entry: "docs" },
  };
}

describe("Farm docs runtime adapters", () => {
  it("recognizes only enabled adapters with server and React entrypoints", () => {
    const docs = createAdapterDocs();

    expect(hasFarmDocsRuntimeAdapter(docs)).toBe(true);
    expect(hasFarmDocsRuntimeAdapter({ ...docs, enabled: false })).toBe(false);
    expect(hasFarmDocsRuntimeAdapter({ ...docs, adapter: undefined })).toBe(false);
    expect(
      hasFarmDocsRuntimeAdapter({
        ...docs,
        adapter: { ...docs.adapter!, react: undefined },
      }),
    ).toBe(false);
  });

  it("passes only host assets and loaders to the adapter-owned handler", async () => {
    const docs = createAdapterDocs();
    const response = new Response("adapter");
    const runtimeHandler = vi.fn(async () => response);
    const createRuntimeHandler = vi.fn(() => runtimeHandler);
    const reactModule = { hydrateFarmDocs: vi.fn() };
    const loadModule = vi.fn(async (specifier: string) => {
      if (specifier === docs.adapter?.server) {
        return { createFarmDocsRuntimeHandler: createRuntimeHandler };
      }
      if (specifier === docs.adapter?.react) return reactModule;
      throw new Error(`Unexpected module: ${specifier}`);
    });

    const handler = await createFarmDocsAdapterHandler(docs, {
      root: "/workspace/app",
      srcDir: "src",
      clientEntry: "/@farm/client.js",
      fontStylesheetHref: "/@farm/fonts.css",
      globalStylesheetHref: "/src/app/globals.css",
      loadModule,
    });

    expect(createRuntimeHandler).toHaveBeenCalledOnce();
    const [runtimeConfig, hostOptions] = createRuntimeHandler.mock.calls[0]!;
    expect(runtimeConfig).toMatchObject({
      entry: "docs",
      docsPath: "/docs",
      contentDir: "/workspace/app/content/docs",
    });
    expect(hostOptions).toMatchObject({
      rootDir: "/workspace/app",
      clientEntry: "/@farm/client.js",
      stylesheets: ["/@farm/fonts.css", "/src/app/globals.css"],
    });
    await expect(hostOptions.loadReactModule()).resolves.toBe(reactModule);
    await expect(handler(new Request("https://farm.test/docs"))).resolves.toBe(response);
  });

  it("reports an actionable error for adapters without a runtime handler", async () => {
    await expect(
      createFarmDocsAdapterHandler(createAdapterDocs(), {
        root: "/workspace/app",
        clientEntry: "/farm-client.js",
        loadModule: async () => ({}),
      }),
    ).rejects.toThrow("Upgrade the adapter to a runtime-enabled release");
  });
});
