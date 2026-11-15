// @vitest-environment node

import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { react } from "../index";
import { createFarmRendererPlugin } from "../vite";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("React renderer Vite integration", () => {
  it("does not install a transform when the compiler is disabled", () => {
    expect(createFarmRendererPlugin({ rendererOptions: react().options })).toEqual([]);
  });

  it("installs automatic inference from compiler: true", () => {
    const plugins = createFarmRendererPlugin({
      rendererOptions: react({ compiler: true }).options,
    });

    expect(plugins.map((plugin) => plugin.name)).toEqual([
      "farm:react-aot-compiler",
      "farm:react-compiled-root",
    ]);
    expect(plugins[0]?.enforce).toBe("pre");
    // The compiled-root import rewrite runs after TypeScript and JSX are compiled.
    expect(plugins[1]?.enforce).toBeUndefined();
  });

  it("still accepts renderer options in the deprecated experimental shape", () => {
    // Renderer options built by an older react() or by hand keep working.
    const plugins = createFarmRendererPlugin({
      rendererOptions: { experimental: { compiler: true } },
    });
    expect(plugins.map((plugin) => plugin.name)).toEqual([
      "farm:react-aot-compiler",
      "farm:react-compiled-root",
    ]);
    expect(createFarmRendererPlugin({ rendererOptions: { compiler: false } })).toEqual([]);
  });

  it.each([null, 0, 1, "", "true", [], () => true].map((compiler) => ({ compiler })))(
    "rejects invalid compiler configuration $compiler through the Vite entry",
    ({ compiler }) => {
      for (const rendererOptions of [{ compiler }, { experimental: { compiler } }]) {
        expect(() => createFarmRendererPlugin({ rendererOptions })).toThrow(
          /compiler must be a boolean or compiler options object/i,
        );
      }
    },
  );

  it.each([
    { compiler: true, experimental: { compiler: false } },
    { compiler: false, experimental: { compiler: true } },
  ])("rejects ambiguous Vite compiler configuration: %s", (rendererOptions) => {
    expect(() => createFarmRendererPlugin({ rendererOptions })).toThrow(/`compiler` only/);
  });

  it("preserves disabled and omitted legacy options", () => {
    for (const rendererOptions of [
      undefined,
      {},
      { compiler: false },
      { experimental: { compiler: false } },
      { compiler: false, experimental: { compiler: undefined } },
    ]) {
      expect(createFarmRendererPlugin({ rendererOptions })).toEqual([]);
    }
  });

  it.each([false, true])(
    "emits identical legacy and top-level compiler output (SSR: %s)",
    async (ssr) => {
      const root = await realpath(await mkdtemp(join(tmpdir(), "farm-react-option-parity-")));
      temporaryDirectories.push(root);
      const entry = join(root, "Counter.tsx");
      await writeFile(
        entry,
        `import { useState } from "react";
         export function Counter() {
           const [count, setCount] = useState(0);
           return <button onClick={() => setCount(count + 1)}>{count}</button>;
         }`,
      );
      for (const compiler of [false, true, { mode: "annotation" as const }]) {
        const outputs = [];
        for (const rendererOptions of [{ compiler }, { experimental: { compiler } }]) {
          const result = await build({
            root,
            configFile: false,
            logLevel: "silent",
            plugins: createFarmRendererPlugin({ ssr, rendererOptions }),
            build: {
              write: false,
              ssr: ssr ? entry : false,
              lib: { entry, formats: ["es"] },
              rollupOptions: { external: [/^react(?:\/|$)/, "@farm.js/react/compiler-runtime"] },
            },
          });
          const builds = Array.isArray(result) ? result : [result];
          outputs.push(
            builds
              .flatMap((output) =>
                "output" in output
                  ? output.output
                      .filter((chunk) => chunk.type === "chunk")
                      .map((chunk) => chunk.code)
                  : [],
              )
              .join("\n"),
          );
        }
        expect(outputs[0]).not.toBe("");
        expect(outputs[0]).toEqual(outputs[1]);
        expect(outputs[0]?.includes("@farm.js/react/compiler-runtime")).toBe(compiler === true);
      }
    },
  );

  it("writes a compiler coverage report after a production build", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "farm-react-vite-report-"));
    temporaryDirectories.push(temporaryRoot);
    const root = await realpath(temporaryRoot);
    const entry = join(root, "App.tsx");
    await writeFile(
      entry,
      `
        import { useState } from "react";
        export function Counter() {
          const [count, setCount] = useState(0);
          return <button onClick={() => setCount(count + 1)}>{count}</button>;
        }
        export function List() {
          const [items, setItems] = useState([{ id: "a", label: "A" }]);
          return <section>
            <button onClick={() => setItems((current) => current.map((item) => item.id === "a" ? { ...item, label: "B" } : item))}>Update</button>
            <ul>{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>
          </section>;
        }
      `,
      "utf8",
    );

    await build({
      root,
      logLevel: "silent",
      plugins: createFarmRendererPlugin({
        rendererOptions: react({ compiler: { report: true } }).options,
      }),
      build: {
        write: false,
        lib: {
          entry,
          formats: ["es"],
        },
        rollupOptions: {
          external: [/^react(?:\/|$)/, "@farm.js/react/compiler-runtime"],
        },
      },
    });

    const report = JSON.parse(await readFile(join(root, ".farm", "react-compiler.json"), "utf8"));
    expect(report.summary).toEqual({
      modules: 1,
      componentsConsidered: 2,
      compiled: 2,
      fallback: 0,
      keyedArrayAppendHints: 0,
      keyedArrayFilterHints: 0,
      keyedArrayPrependHints: 0,
      keyedArrayPositionHints: 0,
      keyedArrayReorderHints: 0,
      keyedArraySortHints: 0,
      keyedArrayMappedRollingWindowChainHints: 0,
      keyedArrayRollingWindowHints: 0,
      keyedArraySliceHints: 0,
      keyedCollectionUpdateHints: 0,
      keyedIdentityTargets: 0,
      keyedMapLookupTargets: 0,
      keyedMembershipTargets: 0,
      keyedMapUpdateHints: 1,
    });
    expect(report.modules[0].compiled).toEqual(["Counter", "List"]);
    expect(report.modules[0].fallbacks).toEqual([]);

    await writeFile(
      entry,
      `
        import { useState } from "react";
        export function ServerOnlyCounter() {
          const [count, setCount] = useState(0);
          return <button onClick={() => setCount(count + 1)}>{count}</button>;
        }
      `,
      "utf8",
    );
    await build({
      root,
      logLevel: "silent",
      plugins: createFarmRendererPlugin({
        ssr: true,
        rendererOptions: react({ compiler: { report: true } }).options,
      }),
      build: {
        write: false,
        ssr: entry,
        rollupOptions: {
          external: [/^react(?:\/|$)/, "@farm.js/react/compiler-runtime"],
        },
      },
    });

    const reportAfterSsr = JSON.parse(
      await readFile(join(root, ".farm", "react-compiler.json"), "utf8"),
    );
    expect(reportAfterSsr).toEqual(report);
  });
});
