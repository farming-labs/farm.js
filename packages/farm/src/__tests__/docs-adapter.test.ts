// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertFarmDocsAdapterServesNoGuardedPages,
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

function createMultiRootDocs(): FarmDocsResolvedConfig {
  return {
    ...createAdapterDocs(),
    configOverrides: { nav: { title: "Farm" } },
    roots: [
      {
        entry: "/statewire/docs",
        contentDir: "content/statewire",
        config: { entry: "statewire/docs", nav: { title: "Statewire" } },
        configOverrides: { nav: { title: "Statewire" } },
      },
      {
        entry: "/pinboard/docs",
        config: { entry: "pinboard/docs" },
        configOverrides: { nav: { title: "Farm" } },
      },
    ],
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
    // Development content changes while the server runs; the adapter must keep
    // reading it.
    expect(hostOptions).not.toHaveProperty("immutableContent");
    await expect(hostOptions.loadReactModule()).resolves.toBe(reactModule);
    await expect(handler(new Request("https://farm.test/docs"))).resolves.toBe(response);
  });

  it("tells the adapter a production build's content is immutable", async () => {
    // The production server is generated source; its adapter handler call is
    // the one place a build's fixed content can be declared.
    const source = await readFile(
      path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
      "utf8",
    );
    const call = source.slice(source.indexOf("`${adapterHandler.factory}("));
    const options = call.slice(call.indexOf("}, {"), call.indexOf("})"));
    expect(options).toContain("rootDir: farmDocsRuntimeRoot,");
    expect(options).toContain("immutableContent: true,");
    expect(options).toContain("modulePreloads: farmDocsModulePreloadPaths,");
    // The page list is filled in after the client build; an unfilled one parses to nothing.
    expect(source).toContain('JSON.parse("${FARM_DOCS_MODULE_PRELOADS_PLACEHOLDER}")');
  });

  it("loads the docs config module through the app's module loader for the runtime", async () => {
    const icon = { $$typeof: Symbol.for("react.transitional.element"), type: "svg", props: {} };
    const docs: FarmDocsResolvedConfig = {
      ...createAdapterDocs(),
      configPath: "/workspace/app/docs.config.tsx",
      configOverrides: { metadata: { description: "From farm.config" } },
    };
    const createRuntimeHandler = vi.fn(() => async () => null);
    const loadModule = vi.fn(async (specifier: string) => {
      if (specifier === docs.adapter?.server) {
        return { createFarmDocsRuntimeHandler: createRuntimeHandler };
      }
      if (specifier === docs.configPath)
        return { default: { entry: "docs", icons: { book: icon } } };
      return {};
    });

    await createFarmDocsAdapterHandler(docs, { root: "/workspace/app", loadModule });

    expect(loadModule).toHaveBeenCalledWith("/workspace/app/docs.config.tsx");
    const [runtimeConfig] = createRuntimeHandler.mock.calls[0]! as unknown as [any];
    expect(runtimeConfig.icons.book).toBe(icon);
    expect(runtimeConfig).toMatchObject({
      docsPath: "/docs",
      metadata: { description: "From farm.config" },
    });
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

  it("hands every docs root to the adapter's multi-root handler, main root first", async () => {
    const docs = { ...createMultiRootDocs(), configPath: "/workspace/app/docs.config.tsx" };
    const response = new Response("adapter");
    const createRuntimeHandler = vi.fn();
    const createMultiRuntimeHandler = vi.fn(() => async () => response);
    const reactModule = { hydrateFarmDocs: vi.fn() };
    const registerMCPServer = vi.fn(() => () => undefined);
    const loadModule = vi.fn(async (specifier: string) => {
      if (specifier === docs.adapter?.server) {
        return {
          createFarmDocsRuntimeHandler: createRuntimeHandler,
          createFarmDocsMultiRuntimeHandler: createMultiRuntimeHandler,
        };
      }
      if (specifier === docs.configPath) return { default: { search: true } };
      if (specifier === docs.adapter?.react) return reactModule;
      throw new Error(`Unexpected module: ${specifier}`);
    });

    const handler = await createFarmDocsAdapterHandler(docs, {
      root: "/workspace/app",
      srcDir: "src",
      clientEntry: "/@farm/client.js",
      fontStylesheetHref: "/@farm/fonts.css",
      loadModule,
      registerMCPServer,
    });

    expect(createRuntimeHandler).not.toHaveBeenCalled();
    expect(createMultiRuntimeHandler).toHaveBeenCalledOnce();
    const [configs, hostOptions] = createMultiRuntimeHandler.mock.calls[0]! as unknown as [
      Record<string, unknown>[],
      any,
    ];
    expect(configs).toEqual([
      {
        search: true,
        nav: { title: "Farm" },
        entry: "docs",
        docsPath: "/docs",
        contentDir: path.resolve("/workspace/app", "content", "docs"),
      },
      {
        search: true,
        nav: { title: "Statewire" },
        entry: "statewire/docs",
        docsPath: "/statewire/docs",
        contentDir: path.resolve("/workspace/app", "content", "statewire"),
      },
      {
        search: true,
        nav: { title: "Farm" },
        entry: "pinboard/docs",
        docsPath: "/pinboard/docs",
        // No content directory of its own: the inferred one, never the main root's.
        contentDir: path.join("/workspace/app", "pinboard/docs"),
      },
    ]);
    expect(hostOptions).toMatchObject({
      rootDir: "/workspace/app",
      clientEntry: "/@farm/client.js",
      stylesheets: ["/@farm/fonts.css"],
      registerMCPServer,
    });
    await expect(hostOptions.loadReactModule()).resolves.toBe(reactModule);
    await expect(handler(new Request("https://farm.test/statewire/docs"))).resolves.toBe(response);
  });

  it("asks for an adapter upgrade when it cannot serve several docs roots", async () => {
    await expect(
      createFarmDocsAdapterHandler(createMultiRootDocs(), {
        root: "/workspace/app",
        clientEntry: "/farm-client.js",
        loadModule: async () => ({ createFarmDocsRuntimeHandler: () => async () => null }),
      }),
    ).rejects.toThrow(
      'Farm docs adapter "@farming-labs/farmjs" does not export createFarmDocsMultiRuntimeHandler ' +
        'from "@farming-labs/farmjs/server". Upgrade the adapter to a release that serves several ' +
        "docs roots, or remove docs.roots.",
    );
  });

  it("refuses a guarded page in any docs root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "farm-docs-adapter-roots-guard-"));
    tempDirs.push(root);
    await mkdir(path.join(root, "content", "docs"), { recursive: true });
    await mkdir(path.join(root, "content", "statewire", "internal"), { recursive: true });
    await writeFile(path.join(root, "content", "docs", "page.md"), "# Docs\n");
    await writeFile(path.join(root, "content", "statewire", "page.md"), "# Statewire\n");
    await writeFile(path.join(root, "content", "statewire", "internal", "page.md"), "# Internal\n");
    const docs = createMultiRootDocs();

    expect(() =>
      assertFarmDocsAdapterServesNoGuardedPages(
        docs,
        { root },
        (pathname) => pathname === "/statewire/docs/internal",
      ),
    ).toThrow("Docs pages behind a path guard (/statewire/docs/internal) would be public");
    expect(() =>
      assertFarmDocsAdapterServesNoGuardedPages(
        docs,
        { root },
        (pathname) => pathname === "/docs/internal",
      ),
    ).not.toThrow();
  });

  it("rejects several docs roots on an edge deployment", async () => {
    const docs = createMultiRootDocs();
    docs.adapter = { ...docs.adapter!, edgeCompiler: "./edge-compiler.js" };

    await expect(
      compileFarmDocsAdapterEdgeManifest(docs, {
        root: "/workspace/app",
        clientEntry: "/farm-client.js",
      }),
    ).rejects.toThrow("docs.roots is not supported on edge deployments yet");
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
