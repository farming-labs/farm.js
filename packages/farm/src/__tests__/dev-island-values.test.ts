// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFarmIslandValuesServer } from "../client/island-value-protocol";
import { REACT_RENDERER } from "../renderer";
import { ServerRenderer } from "../server/renderer";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function initialize(serverComponents?: { mode: "islands" }) {
  const root = mkdtempSync(path.join(tmpdir(), "farm-dev-island-values-"));
  roots.push(root);
  const renderer = new ServerRenderer(
    {
      root,
      outDir: "dist",
      srcDir: "src",
      renderer: REACT_RENDERER,
      experimental: serverComponents ? { serverComponents } : {},
    } as never,
    { setRendererRuntime() {} } as never,
  );
  await renderer.initialize();
}

describe("development island values", () => {
  it("encode typed props only in islands mode, also after a restart that turns it off", async () => {
    await initialize({ mode: "islands" });
    expect(getFarmIslandValuesServer()?.encodeLeaf(new Date(0))).toEqual({
      $: "D",
      v: "1970-01-01T00:00:00.000Z",
    });
    // Without islands mode, isolated hydration sends plain JSON: a Date is not encoded, and an
    // undefined prop keeps its server HTML instead of crossing as {"$":"u"}.
    await initialize();
    expect(getFarmIslandValuesServer()).toBeUndefined();
  });
});
