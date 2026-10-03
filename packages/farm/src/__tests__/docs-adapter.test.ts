// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compileFarmDocsAdapterEdgeManifest,
  createFarmDocsAdapterHandler,
  hasFarmDocsRuntimeAdapter,
} from "../docs/adapter";
import type { FarmDocsResolvedConfig } from "../docs/types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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
      contentDir: path.resolve("/workspace/app", "content", "docs"),
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

  it("loads an edge compiler capability from the application", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "farm-docs-adapter-edge-"));
    tempDirs.push(root);
    await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(
      path.join(root, "edge-compiler.js"),
      `export function compileFarmDocsEdgeManifest(config, options) {
  const response = {
    status: 200,
    statusText: "OK",
    headers: [["content-type", "application/json"]],
    body: JSON.stringify({ config, options }),
  };
  return {
    protocol: 1,
    originPlaceholder: "https://farm-docs-build.invalid",
    entry: String(config.entry),
    routes: { "/docs": response },
    api: {
      static: {},
      markdown: {},
      empty: response,
      post: response,
      search: { pages: [], search: false, siteTitle: "Fixture" },
    },
  };
}
`,
    );
    const docs = createAdapterDocs();
    docs.adapter = {
      ...docs.adapter!,
      edgeCompiler: "./edge-compiler.js",
    };

    const manifest = await compileFarmDocsAdapterEdgeManifest(docs, {
      root,
      srcDir: "src",
      clientEntry: "/farm-client.js",
      fontStylesheetHref: "/farm-fonts.css",
      globalStylesheetHref: "/assets/globals.css",
    });

    expect(JSON.parse(manifest.routes["/docs"]!.body)).toEqual({
      config: {
        entry: "docs",
        docsPath: "/docs",
        contentDir: path.resolve(root, "content", "docs"),
      },
      options: {
        rootDir: root,
        clientEntry: "/farm-client.js",
        stylesheets: ["/farm-fonts.css", "/assets/globals.css"],
      },
    });
  });
});
