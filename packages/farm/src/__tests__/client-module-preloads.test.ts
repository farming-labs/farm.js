import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectFarmClientModulePreloads,
  encodeFarmClientModulePreloads,
  type FarmClientModulePreloadManifest,
} from "../nitro/client-module-preloads";

const root = path.resolve("/app");
const chunk = (
  fileName: string,
  imports: string[] = [],
  extra: { entry?: string; module?: string } = {},
) => ({
  type: "chunk",
  fileName,
  imports,
  ...(extra.entry ? { isEntry: true, name: extra.entry } : {}),
  ...(extra.module ? { isDynamicEntry: true, facadeModuleId: extra.module } : {}),
});

describe("client module preloads", () => {
  const bundle = {
    "farm-client-h1.js": chunk("farm-client-h1.js", ["chunks/react.js", "chunks/app.js"], {
      entry: "farm-client",
    }),
    "chunks/react.js": chunk("chunks/react.js"),
    "chunks/app.js": chunk("chunks/app.js", [
      "chunks/react.js",
      "chunks/util.js",
      "farm-client-h1.js",
    ]),
    "chunks/util.js": chunk("chunks/util.js"),
    "chunks/page.js": chunk("chunks/page.js", ["chunks/react.js", "chunks/chart.js"], {
      module: path.join(root, "src/app/page.tsx"),
    }),
    "chunks/chart.js": chunk("chunks/chart.js", ["chunks/util.js", "chunks/icons.js"]),
    "chunks/icons.js": chunk("chunks/icons.js"),
    "chunks/counter.js": chunk("chunks/counter.js", ["chunks/icons.js"], {
      module: `${path.join(root, "src/counter.tsx")}?v=1`,
    }),
    "chunks/virtual.js": chunk("chunks/virtual.js", [], { module: "\0virtual:thing" }),
    "farm-client.css": { type: "asset" },
  };

  it("lists the entry's static imports, and each dynamic module's chunks outside them", () => {
    const manifest = collectFarmClientModulePreloads(bundle, { root, entryName: "farm-client" })!;
    const files = (indexes: number[]) => indexes.map((index) => manifest.files[index]);
    expect(files(manifest.entry)).toEqual(["chunks/react.js", "chunks/app.js", "chunks/util.js"]);
    expect(Object.keys(manifest.modules).sort()).toEqual(["/src/app/page.tsx", "/src/counter.tsx"]);
    expect(files(manifest.modules["/src/app/page.tsx"]!)).toEqual([
      "chunks/page.js",
      "chunks/chart.js",
      "chunks/icons.js",
    ]);
    expect(files(manifest.modules["/src/counter.tsx"]!)).toEqual([
      "chunks/counter.js",
      "chunks/icons.js",
    ]);
    expect(manifest.router).toEqual([]);
  });

  it("lists the router modules' chunks and their static imports outside the entry's", () => {
    const router = path.join(root, ".farm/tmp/client-entry-1/farm-client-router.tsx");
    const routes = path.join(root, ".farm/tmp/client-entry-1/farm-client-routes.tsx");
    const manifest = collectFarmClientModulePreloads(
      {
        ...bundle,
        "chunks/router.js": chunk("chunks/router.js", ["chunks/react.js", "chunks/nav.js"], {
          module: router,
        }),
        "chunks/nav.js": chunk("chunks/nav.js"),
        "chunks/routes.js": chunk("chunks/routes.js", ["chunks/nav.js"], {
          module: `${routes}?v=1`,
        }),
      },
      {
        root,
        entryName: "farm-client",
        routerModules: [router, routes, path.join(root, "src/missing.tsx")],
      },
    )!;
    expect(manifest.router.map((index) => manifest.files[index])).toEqual([
      "chunks/router.js",
      "chunks/nav.js",
      "chunks/routes.js",
    ]);
  });

  it("lists the renderer modules' chunks and their static imports outside the entry's", () => {
    const reactDom = path.join(root, "node_modules/react-dom/client.js");
    const islands = path.join(root, "node_modules/@farm.js/core/dist/internal/islands-runtime.mjs");
    const manifest = collectFarmClientModulePreloads(
      {
        ...bundle,
        "chunks/client.js": chunk("chunks/client.js", ["chunks/react.js", "chunks/scheduler.js"], {
          module: reactDom,
        }),
        "chunks/scheduler.js": chunk("chunks/scheduler.js"),
        "chunks/islands-runtime.js": chunk(
          "chunks/islands-runtime.js",
          ["chunks/client.js", "chunks/islx.js"],
          { module: islands },
        ),
        "chunks/islx.js": chunk("chunks/islx.js", ["chunks/react.js"]),
      },
      { root, entryName: "farm-client", rendererModules: [reactDom, islands] },
    )!;
    expect(manifest.renderer!.map((index) => manifest.files[index])).toEqual([
      "chunks/client.js",
      "chunks/scheduler.js",
      "chunks/islands-runtime.js",
      "chunks/islx.js",
    ]);
    // An entry that imports its renderer statically has none to list.
    expect(
      collectFarmClientModulePreloads(bundle, { root, entryName: "farm-client" })!.renderer,
    ).toBeUndefined();
  });

  it("lists the root module's chunks, also from a common chunk that holds it without a facade", () => {
    const rootModule = path.join(root, ".farm/tmp/client-entry-1/farm-client-root.tsx");
    const manifest = collectFarmClientModulePreloads(
      {
        ...bundle,
        // The router imports it by name too, so the bundler can merge it into a shared chunk.
        "chunks/shared.js": {
          ...chunk("chunks/shared.js", ["chunks/react.js", "chunks/layout.js"]),
          moduleIds: [path.join(root, "src/search-params.ts"), `${rootModule}?v=1`],
        },
        "chunks/layout.js": chunk("chunks/layout.js", ["chunks/util.js"]),
      },
      { root, entryName: "farm-client", rootModules: [rootModule] },
    )!;
    expect(manifest.root!.map((index) => manifest.files[index])).toEqual([
      "chunks/shared.js",
      "chunks/layout.js",
    ]);
    expect(
      collectFarmClientModulePreloads(bundle, { root, entryName: "farm-client" })!.root,
    ).toBeUndefined();
  });

  it("returns null without the entry", () => {
    expect(
      collectFarmClientModulePreloads(
        { "a.js": chunk("a.js", ["b.js"]) },
        { root, entryName: "farm-client" },
      ),
    ).toBeNull();
  });

  it("encodes a manifest that survives any string literal", () => {
    const manifest = { files: ["chunks/a$&'`\" .js"], entry: [0], router: [0], modules: {} };
    const encoded = encodeFarmClientModulePreloads(manifest);
    for (const quote of [`"`, `'`, "`"]) {
      // eslint-disable-next-line no-new-func
      const decoded = new Function(`return ${quote}${encoded}${quote};`)() as string;
      expect(JSON.parse(decoded)).toEqual(manifest);
    }
    expect(JSON.parse(encodeFarmClientModulePreloads(null))).toBeNull();
  });
});

// The production server emits these from a template literal, so the snippet is extracted from the
// source and un-escaped (\\ -> \, \` -> `, \$ -> $) before it runs as the server bundle runs it.
describe("the server's client module preloads", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
    "utf8",
  );
  const start = source.indexOf("const farmClientEntryPreloadTags = farmClientModulePreloads");
  const bootStart = source.indexOf("function renderFarmClientBootPreloads(", start);
  const end = source.indexOf("\n}\n", bootStart);
  const create = (manifest: FarmClientModulePreloadManifest) =>
    new Function(
      "farmClientModulePreloads",
      "farmSecurityConfig",
      "escapeFarmHtmlAttribute",
      "FARM_DEFERRED_ISLAND_STRATEGY",
      `${source.slice(start, end + 2).replace(/\\([\\`$])/g, "$1")}
return { renderFarmClientModulePreloads, renderFarmClientBootPreloads };`,
    )(manifest, {}, (value: string) => value, /\sstrategy="(?:interaction|visible|idle)"/) as {
      renderFarmClientModulePreloads(
        markup: string | null,
        pageModule: string | undefined,
        navigation: boolean,
        hydratesRoot: boolean,
      ): string;
      renderFarmClientBootPreloads(
        markup: string | null,
        pageModule: string | undefined,
        root: string,
        rootStrategy: string,
        navigation: boolean,
      ): string;
    };
  const { renderFarmClientModulePreloads, renderFarmClientBootPreloads } = create({
    files: [
      "chunks/react.js",
      "chunks/router.js",
      "chunks/react-dom.js",
      "chunks/root.js",
      "chunks/page.js",
    ],
    entry: [0],
    router: [1],
    renderer: [2],
    root: [3],
    modules: { "/src/app/page.tsx": [4] },
  });
  const hrefs = (html: string) => [...html.matchAll(/href="\/([^"]+)"/g)].map((match) => match[1]);

  it("lists the code that renders a root for a document whose page or layout hydrates", () => {
    expect(hrefs(renderFarmClientModulePreloads(null, "/src/app/page.tsx", false, true))).toEqual([
      "chunks/react.js",
      "chunks/react-dom.js",
      "chunks/root.js",
      "chunks/page.js",
    ]);
    // A page of islands only, and a client navigation's response, which runs no script.
    expect(hrefs(renderFarmClientModulePreloads(null, undefined, false, false))).toEqual([
      "chunks/react.js",
      "chunks/react-dom.js",
    ]);
    expect(hrefs(renderFarmClientModulePreloads(null, undefined, true, true))).toEqual([
      "chunks/react.js",
    ]);
  });

  it("fetches the root's code with the boot's entry, or on a click in a root that waits for one", () => {
    expect(renderFarmClientBootPreloads(null, "/src/app/page.tsx", "root", "visible", false)).toBe(
      ' data-farm-preload="chunks/react.js chunks/root.js chunks/page.js"' +
        ' data-farm-preload-router="chunks/router.js"' +
        ' data-farm-preload-renderer="chunks/react-dom.js"',
    );
    expect(
      renderFarmClientBootPreloads(null, "/src/app/page.tsx", "root", "interaction", false),
    ).toBe(
      ' data-farm-preload="chunks/react.js"' +
        ' data-farm-preload-router="chunks/router.js"' +
        ' data-farm-preload-renderer="chunks/react-dom.js"' +
        ' data-farm-preload-root="chunks/root.js chunks/page.js"',
    );
    expect(renderFarmClientBootPreloads(null, undefined, "", "", false)).not.toContain("root.js");
  });
});
