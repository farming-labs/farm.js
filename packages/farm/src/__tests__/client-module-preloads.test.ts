import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectFarmClientModulePreloads,
  encodeFarmClientModulePreloads,
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
