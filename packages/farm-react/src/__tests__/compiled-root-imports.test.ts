// @vitest-environment node

import { parseAst, type Plugin } from "vite";
import { describe, expect, it } from "vitest";
import { createFarmRendererPlugin, rewriteCompiledRootImports } from "../vite";

const rewrite = (code: string) => rewriteCompiledRootImports(code, parseAst(code));

function compiledRootPlugin(compiler: unknown): Plugin | undefined {
  return createFarmRendererPlugin({ rendererOptions: { compiler } }).find(
    (plugin) => plugin.name === "farm:react-compiled-root",
  );
}

function transform(plugin: Plugin, code: string, id: string, ssr = false): unknown {
  const hook = plugin.transform as (
    this: { parse: typeof parseAst },
    code: string,
    id: string,
    options?: { ssr?: boolean },
  ) => unknown;
  return hook.call({ parse: parseAst }, code, id, { ssr });
}

describe("rewriteCompiledRootImports", () => {
  it("points an app's createRoot import at the compiled root", () => {
    expect(rewrite('import { createRoot } from "react-dom/client";\ncreateRoot(main);')).toBe(
      'import { createRoot } from "@farm.js/react/compiled-root";\ncreateRoot(main);',
    );
    expect(rewrite("import { createRoot as mount } from 'react-dom/client';")).toBe(
      'import { createRoot as mount } from "@farm.js/react/compiled-root";',
    );
  });

  it("leaves imports that need the rest of React DOM alone", () => {
    for (const code of [
      'import { createRoot, hydrateRoot } from "react-dom/client";',
      'import { hydrateRoot } from "react-dom/client";',
      'import * as client from "react-dom/client";',
      'import client from "react-dom/client";',
      'import "react-dom/client";',
      'import { createRoot } from "react-dom";',
      'const client = import("react-dom/client");',
    ]) {
      expect(rewrite(code), code).toBeNull();
    }
  });
});

describe("farm:react-compiled-root", () => {
  const code = 'import { createRoot } from "react-dom/client";';

  it("rewrites browser app modules when the compiler is on", () => {
    const plugin = compiledRootPlugin(true)!;
    expect(transform(plugin, code, "/app/src/main.tsx")).toContain("@farm.js/react/compiled-root");
  });

  it("leaves server modules, dependencies and opted-out apps to React DOM", () => {
    const plugin = compiledRootPlugin(true)!;
    expect(transform(plugin, code, "/app/src/main.tsx", true)).toBeNull();
    expect(transform(plugin, code, "/app/node_modules/lib/index.js")).toBeNull();
    expect(
      transform(compiledRootPlugin({ compiledRoot: false })!, code, "/app/src/main.tsx"),
    ).toBeNull();
    expect(compiledRootPlugin(false)).toBeUndefined();
  });
});
