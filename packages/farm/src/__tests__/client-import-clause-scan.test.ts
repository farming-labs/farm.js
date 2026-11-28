// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getClientModuleMetadata } from "../utils/client-component";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(source: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-import-clause-"));
  roots.push(root);
  const pkg = path.join(root, "node_modules", "client-kit");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), '{"exports":"./index.js"}');
  fs.writeFileSync(path.join(pkg, "index.js"), '"use client"; export const Widget = () => null;');
  const file = path.join(root, "page.tsx");
  fs.writeFileSync(file, source);
  return { root, file };
}

describe("named import clause scanning", () => {
  it("does not repeatedly visit earlier tokens for a large named-export barrel", () => {
    const exports = 200;
    const { file, root } = fixture(
      Array.from(
        { length: exports },
        (_, index) => `export { Widget as Widget${index} } from "client-kit";`,
      ).join("\n"),
    );
    let visits = 0;
    const findIndex = Array.prototype.findIndex;
    const spy = vi
      .spyOn(Array.prototype, "findIndex")
      .mockImplementation(function (predicate, thisArg) {
        const tokens = this[0]?.kind === "identifier";
        return findIndex.call(this, (value, index, array) => {
          if (tokens) visits++;
          return predicate.call(thisArg, value, index, array);
        });
      });
    let metadata;
    try {
      metadata = getClientModuleMetadata(file, root);
    } finally {
      spy.mockRestore();
    }
    expect(metadata.shouldHydrate).toBe(true);
    expect(visits).toBeLessThan(exports * 50);
  });

  it.each([
    ['import { type Widget as W } from "client-kit";', false],
    ['export { type Widget as W } from "client-kit";', false],
    ['import { type Props, Widget as W } from "client-kit";', true],
    ['export { type Props, Widget as W } from "client-kit";', true],
    ['export { Widget as W, type Props } from "client-kit"', true],
    ['export {} from "client-kit";', false],
    ['const before = { nested: {} };\nexport { Widget as W } from "client-kit"', true],
    ['export { type Props } from "client-kit"\nexport { Widget as W } from "client-kit"', true],
  ])("preserves hydration classification for %s", (source, expected) => {
    const { file, root } = fixture(source);
    expect(getClientModuleMetadata(file, root).shouldHydrate).toBe(expected);
  });
});
