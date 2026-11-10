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
    const manifest = { files: ["chunks/a$&'`\" .js"], entry: [0], modules: {} };
    const encoded = encodeFarmClientModulePreloads(manifest);
    for (const quote of [`"`, `'`, "`"]) {
      // eslint-disable-next-line no-new-func
      const decoded = new Function(`return ${quote}${encoded}${quote};`)() as string;
      expect(JSON.parse(decoded)).toEqual(manifest);
    }
    expect(JSON.parse(encodeFarmClientModulePreloads(null))).toBeNull();
  });
});
