import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContentTypeDeclarations } from "../content-types";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "farm-content-types-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  return root;
}

describe("content type declarations", () => {
  it("infers the plugin registry from farm.config without importing the optional package", () => {
    const root = createRoot();
    writeFileSync(path.join(root, "farm.config.ts"), "export default { plugins: [] };\n");

    const declarations = createContentTypeDeclarations(
      { root },
      path.join(root, "src", "farm.d.ts"),
    );

    expect(declarations).toContain('import type FarmContentConfig0 from "../farm.config"');
    expect(declarations).toContain("__farmContentRegistry");
    expect(declarations).toContain("interface ContentRegistry");
    expect(declarations).not.toContain("@farm.js/content");
  });

  it("combines content registries contributed by layers and the app", () => {
    const root = createRoot();
    const layer = path.join(root, "layer", "farm.config.ts");
    mkdirSync(path.dirname(layer), { recursive: true });
    writeFileSync(layer, "export default { plugins: [] };\n");
    writeFileSync(path.join(root, "farm.config.ts"), "export default { plugins: [] };\n");

    const declarations = createContentTypeDeclarations(
      { root, layerConfigPaths: [layer] },
      path.join(root, "src", "farm.d.ts"),
    );

    expect(declarations).toContain("FarmContentRegistry0 | FarmContentRegistry1");
    expect(declarations).toContain("FarmContentUnionToIntersection");
  });

  it("emits an empty registry when no config exists", () => {
    const root = createRoot();
    const declarations = createContentTypeDeclarations(
      { root },
      path.join(root, "src", "farm.d.ts"),
    );

    expect(declarations).toContain("collections: {}");
  });
});
