// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGES = 12;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("production build hydration plans", () => {
  it("reads a module every route imports a bounded number of times, not once per route", async () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(packageRoot, ".tmp-production-build-plan-reads-")),
    );
    const write = (relativePath: string, source: string) => {
      fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
      fs.writeFileSync(path.join(root, relativePath), source);
    };
    try {
      fs.mkdirSync(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      fs.symlinkSync(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
      write("package.json", '{"type":"module","private":true}');
      write(
        "src/app/layout.tsx",
        "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n",
      );
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
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 180_000);
});
