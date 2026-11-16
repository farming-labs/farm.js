// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGES = 12;

// The route modules each hydration plan is computed for, and the sources Farm's analyses parse.
const calls = vi.hoisted(() => ({ planned: [] as string[], parsed: [] as string[] }));
vi.mock("../utils/client-component", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/client-component")>();
  return {
    ...actual,
    getClientModuleHydrationPlan: (
      ...args: Parameters<typeof actual.getClientModuleHydrationPlan>
    ) => {
      calls.planned.push(args[0]);
      return actual.getClientModuleHydrationPlan(...args);
    },
  };
});
vi.mock("rolldown/parseAst", async (importOriginal) => {
  const actual = await importOriginal<typeof import("rolldown/parseAst")>();
  return {
    ...actual,
    parseAst: (...args: Parameters<typeof actual.parseAst>) => {
      calls.parsed.push(args[0]);
      return actual.parseAst(...args);
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  calls.planned.length = 0;
  calls.parsed.length = 0;
});

function createApp(name: string) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(packageRoot, `.tmp-${name}-`)));
  const write = (relativePath: string, source: string) => {
    fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(root, relativePath), source);
  };
  fs.mkdirSync(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  fs.symlinkSync(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  write("package.json", '{"type":"module","private":true}');
  write(
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n",
  );
  return { root, write };
}

describe("production build hydration plans", () => {
  it("reads a module every route imports a bounded number of times, and plans each page once", async () => {
    const { root, write } = createApp("production-build-plan-reads");
    try {
      write(
        "src/ui/index.ts",
        Array.from(
          { length: 4 },
          (_, index) => `export { Part${index} } from "./part-${index}";`,
        ).join("\n"),
      );
      for (let index = 0; index < 4; index++) {
        write(
          `src/ui/part-${index}.tsx`,
          `export function Part${index}({ children }) { return <div>{children}</div>; }\n`,
        );
      }
      write(
        "src/ui/counter.tsx",
        '"use client";\nimport { useState } from "react";\nexport function Counter() { const [n, setN] = useState(0); return <button onClick={() => setN(n + 1)}>{n}</button>; }\n',
      );
      for (let index = 0; index < PAGES; index++) {
        write(
          `src/app/page-${index}/page.tsx`,
          `import { Part${index % 4} } from "../../ui";\nimport { Counter } from "../../ui/counter";\nexport default function Page() { return <Part${index % 4}>page ${index}<Counter /></Part${index % 4}>; }\n`,
        );
      }

      const barrel = path.join(root, "src", "ui", "index.ts");
      let barrelReads = 0;
      const readFileSync = fs.readFileSync;
      vi.spyOn(fs, "readFileSync").mockImplementation(((
        file: fs.PathOrFileDescriptor,
        ...rest: []
      ) => {
        if (file === barrel) barrelReads++;
        return readFileSync.call(fs, file, ...rest);
      }) as typeof fs.readFileSync);

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          telemetry: false,
          images: { provider: "none" },
          deploy: { target: "node-server" },
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const client = fs.readFileSync(
        path.join(root, ".farm", "client", "farm-client-manifest.json"),
        "utf8",
      );
      expect(client.length).toBeGreaterThan(0);
      // The route manager's plan and the build's client and SSR plans each read it once in their
      // source snapshot. Planned without one, the build read it again for every route.
      expect(barrelReads).toBeGreaterThan(0);
      expect(barrelReads).toBeLessThan(PAGES);
      // The client and SSR route tables reuse the route manager's plans; they planned every page
      // and layout again before.
      const page = path.join(root, "src", "app", "page-0", "page.tsx");
      const layout = path.join(root, "src", "app", "layout.tsx");
      expect(calls.planned.filter((module) => module === page)).toHaveLength(1);
      expect(calls.planned.filter((module) => module === layout)).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 180_000);

  it("rewrites islands' package client imports from what the route manager's plan learned", async () => {
    const { root, write } = createApp("production-build-rewrite-reads");
    try {
      write(
        "node_modules/toggle-kit/package.json",
        JSON.stringify({ name: "toggle-kit", type: "module", exports: { ".": "./index.js" } }),
      );
      write(
        "node_modules/toggle-kit/index.js",
        `"use client";
import { createElement, useState } from "react";
export function Toggle() {
  const [on, setOn] = useState(false);
  return createElement("button", { onClick: () => setOn(!on) }, on ? "on" : "off");
}
`,
      );
      for (let index = 0; index < PAGES; index++) {
        write(
          `src/app/page-${index}/page.tsx`,
          `import { Toggle } from "toggle-kit";\nexport default function Page() { return <main>islands page ${index} <Toggle /></main>; }\n`,
        );
      }

      const manifest = path.join(root, "node_modules", "toggle-kit", "package.json");
      let manifestReads = 0;
      const readFileSync = fs.readFileSync;
      vi.spyOn(fs, "readFileSync").mockImplementation(((
        file: fs.PathOrFileDescriptor,
        ...rest: []
      ) => {
        if (file === manifest) manifestReads++;
        return readFileSync.call(fs, file, ...rest);
      }) as typeof fs.readFileSync);

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          telemetry: false,
          images: { provider: "none" },
          deploy: { target: "node-server" },
          experimental: { serverComponents: { mode: "islands" } },
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const server = fs
        .readdirSync(path.join(root, ".farm", ".output", "server"), {
          recursive: true,
          withFileTypes: true,
        })
        .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
        .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
        .join("\n");
      // Every page renders the package's Toggle through its client reference.
      expect(server).toContain(".farm/client-references/toggle-kit/Toggle.tsx");
      // The SSR transform of a page parses it once for its two package import rewrites (twice
      // before), and takes what it asks about toggle-kit from the route manager's plan of the page:
      // the build read toggle-kit's manifest 105 times for 12 pages before, 57 now.
      const page = fs.readFileSync(path.join(root, "src", "app", "page-0", "page.tsx"), "utf8");
      expect(calls.parsed.filter((code) => code === page)).toHaveLength(1);
      expect(manifestReads).toBeLessThan(PAGES * 6);
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 180_000);
});
