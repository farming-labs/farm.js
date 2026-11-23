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
    expect(plain).toContain("farm:preact-react-compat");

    const compiled = pluginNames(
      await createFarmRendererPlugin({ rendererOptions: preact({ compiler: true }).options }),
    );
    expect(compiled).toContain("farm:react-aot-compiler");
    expect(compiled).toContain("farm:preact-react-compat");
  });
});

// Farm's hooks import react, which a Preact app need not install. Node loaded them from an
// external @farm.js/core when a build read route modules, and the server build left the import
// bare, so the build or the server failed with "Cannot find package 'react'".
describe("Farm's modules on the server", () => {
  async function reactCompat(compiler = false) {
    const plugins = (await createFarmRendererPlugin(
      compiler ? { rendererOptions: preact({ compiler: true }).options } : {},
    )) as Array<{ name?: string } & Record<string, any>>;
    const plugin = plugins.flat().find((entry) => entry?.name === "farm:preact-react-compat")!;
    plugin.configResolved({ root: "/app" });
    return plugin;
  }
  const transform = (plugin: Record<string, any>, id: string, ssr = true) =>
    plugin.transform.call(
      { parse: (code: string) => parseAst(code) },
      'import { useState } from "react";',
      id,
      { ssr },
    );

  // The bindings import @farm.js/core, so an external @farm.js/preact loads core outside Vite
  // too. A linked workspace package always loads through Vite, so only this check catches it here.
  it("load through Vite, with the compiler runtime only when the compiler is on", async () => {
    expect((await reactCompat()).config().ssr.noExternal).toEqual([
      "@farm.js/core",
      "@farm.js/preact",
    ]);
    expect((await reactCompat(true)).config().ssr.noExternal).toEqual([
      "@farm.js/core",
      "@farm.js/preact",
      "@farm.js/react",
    ]);
  });

  it("import preact/compat in place of react", async () => {
    const plugin = await reactCompat();
    for (const id of [
      "/app/node_modules/@farm.js/core/dist/chunk-router.mjs",
      "/repo/packages/farm/dist/navigation.mjs",
      "/app/src/app/page.tsx",
    ]) {
      expect(transform(plugin, id), id).toBe('import { useState } from "preact/compat";');
    }
  });

  it("leave other packages and browser modules alone", async () => {
    const plugin = await reactCompat();
    expect(transform(plugin, "/app/node_modules/react-icons/dist/index.mjs")).toBeNull();
    expect(transform(plugin, "/app/node_modules/@farm.js/core/dist/client.mjs", false)).toBeNull();
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
