// @vitest-environment node

import { parseAst } from "vite";
import { describe, expect, it } from "vitest";
import { preact } from "../index";
import { createFarmRendererPlugin, rewriteReactSpecifiers } from "../vite";

const pluginNames = (plugins: unknown[]): string[] =>
  plugins
    .flat(Infinity as 1)
    .map((plugin) => (plugin as { name?: string } | null)?.name)
    .filter((name): name is string => typeof name === "string");

describe("preact({ compiler })", () => {
  it("leaves the renderer unchanged without the compiler", () => {
    const renderer = preact();
    expect(renderer.options).toBeUndefined();
    expect(renderer.optimizeDeps).not.toContain("@farm.js/react/compiler-runtime");
  });

  it("passes compiler options through and seeds the compiler runtime", () => {
    const renderer = preact({ compiler: { reactivity: "static", report: true } });
    expect(renderer.options).toEqual({ compiler: { reactivity: "static", report: true } });
    expect(renderer.optimizeDeps).toContain("@farm.js/react/compiler-runtime");
    expect(preact({ compiler: false }).options).toBeUndefined();
  });

  it("rejects a compiler option that is neither a boolean nor an object", () => {
    expect(() => preact({ compiler: "hybrid" as never })).toThrow(TypeError);
  });

  it("adds Farm's compiler to the Preact preset only when enabled", async () => {
    const plain = pluginNames(await createFarmRendererPlugin());
    expect(plain).not.toContain("farm:react-aot-compiler");
    expect(plain).not.toContain("farm:preact-compiler-runtime");

    const compiled = pluginNames(
      await createFarmRendererPlugin({ rendererOptions: preact({ compiler: true }).options }),
    );
    expect(compiled).toContain("farm:react-aot-compiler");
    expect(compiled).toContain("farm:preact-compiler-runtime");
  });
});

describe("rewriteReactSpecifiers", () => {
  const rewrite = (code: string) => rewriteReactSpecifiers(code, parseAst(code));

  it("points React imports, re-exports and dynamic imports at preact/compat", () => {
    const code = [
      'import React, { useState } from "react";',
      "import { flushSync } from 'react-dom';",
      'import { createRoot } from "react-dom/client";',
      'import { jsx } from "react/jsx-runtime";',
      'export { memo } from "react";',
      'export * from "react-dom";',
      'const lazy = () => import("react");',
    ].join("\n");
    expect(rewrite(code)).toBe(
      [
        'import React, { useState } from "preact/compat";',
        'import { flushSync } from "preact/compat";',
        'import { createRoot } from "preact/compat/client";',
        'import { jsx } from "preact/jsx-runtime";',
        'export { memo } from "preact/compat";',
        'export * from "preact/compat";',
        'const lazy = () => import("preact/compat");',
      ].join("\n"),
    );
  });

  it("leaves other packages and plain strings alone", () => {
    const code = [
      'import { Icon } from "react-icons";',
      'import reactive from "reactive";',
      'import { renderToString } from "react-dom/server";',
      'const name = "react";',
    ].join("\n");
    expect(rewrite(code)).toBeNull();
  });
});
