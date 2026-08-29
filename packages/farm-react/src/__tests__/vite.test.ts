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
      rendererOptions: react({ experimental: { compiler: true } }).options,
    });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("farm:react-aot-compiler");
    expect(plugins[0]?.enforce).toBe("pre");
  });

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
        rendererOptions: react({
          experimental: {
            compiler: { report: true },
          },
        }).options,
      }),
      build: {
        write: false,
        lib: {
          entry,
          formats: ["es"],
        },
        rollupOptions: {
          external: ["react", "@farm.js/react/compiler-runtime"],
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
        rendererOptions: react({
          experimental: {
            compiler: { report: true },
          },
        }).options,
      }),
      build: {
        write: false,
        ssr: entry,
        rollupOptions: {
          external: ["react", "@farm.js/react/compiler-runtime"],
        },
      },
    });

    const reportAfterSsr = JSON.parse(
      await readFile(join(root, ".farm", "react-compiler.json"), "utf8"),
    );
    expect(reportAfterSsr).toEqual(report);
  });
});
