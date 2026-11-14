// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { readFarmClientModulePreloads } from "../nitro/client-module-preloads";

/**
 * The production client build dropped the app's `vite.build.rolldownOptions.output`, so an app
 * could not choose its own chunking (`codeSplitting`) or other output options.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHARED_MARKER = "APP_SHARED_GROUP_MARKER";

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-client-output-options-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  const write = async (file: string, contents: string) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), contents.trim() + "\n");
  };
  await write("package.json", JSON.stringify({ private: true, type: "module" }));
  await write("src/app/globals.css", "");
  await write(
    "farm.config.ts",
    `
export default {
  images: { provider: "none" },
  vite: {
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: { groups: [{ name: "app-shared", test: /src[\\\\/]lib[\\\\/]/ }] },
          // Farm owns the file names the server reads.
          entryFileNames: "app-entry.js",
          chunkFileNames: "[name].js",
        },
      },
    },
  },
};
`,
  );
  await write(
    "src/app/layout.tsx",
    `export default function Layout({ children }) { return <div>{children}</div>; }`,
  );
  // Each lib module is used by one page only, so automatic chunking would keep it in that page's
  // chunk; the app's group puts both in one chunk.
  for (const name of ["a", "b"]) {
    await write(
      `src/lib/${name}.ts`,
      `export const ${name} = "${SHARED_MARKER}_${name}" + Math.random();`,
    );
    await write(
      `src/app/${name}/counter.tsx`,
      `
"use client";
import { useState } from "react";
import { ${name} } from "../../lib/${name}";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button data-value={${name}} onClick={() => setCount(count + 1)}>{count}</button>;
}
`,
    );
    await write(
      `src/app/${name}/page.tsx`,
      `
import { Counter } from "./counter";

export default function Page() {
  return <main>${name}<Counter /></main>;
}
`,
    );
  }
  return root;
}

describe("production client output options", () => {
  it("applies the app's output options to the client build under Farm's file names", async () => {
    const root = await createFixture();

    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });

      const publicDir = path.join(root, ".farm", ".output", "public");
      const files = (await fs.readdir(publicDir, { recursive: true })).map((file) =>
        String(file).replace(/\\/g, "/"),
      );
      const group = files.filter((file) => /^chunks\/app-shared-h[0-9a-f]+\.js$/.test(file));
      expect(group, files.join("\n")).toHaveLength(1);
      const groupCode = await fs.readFile(path.join(publicDir, group[0]!), "utf8");
      expect(groupCode).toContain(`${SHARED_MARKER}_a`);
      expect(groupCode).toContain(`${SHARED_MARKER}_b`);

      expect(files.some((file) => /^farm-client-h[0-9a-f]+\.js$/.test(file))).toBe(true);
      expect(files).not.toContain("app-entry.js");

      // Both pages preload the group's chunk, which exists.
      const manifest = await readFarmClientModulePreloads(path.join(root, ".farm"));
      for (const page of ["/src/app/a/page.tsx", "/src/app/b/page.tsx"]) {
        const preloads = manifest!.modules[page]!.map((index) => manifest!.files[index]);
        expect(preloads).toContain(group[0]);
      }
      for (const file of manifest!.files) expect(files).toContain(file);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
