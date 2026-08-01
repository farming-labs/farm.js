// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defineConfig } from "../vite";

describe("Farm Vite dependency optimization", () => {
  it("pre-bundles framework client entries with React", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-vite-config-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "counter.tsx"),
      `'use client';\nimport { useState } from "react";\nexport function Counter() { return useState(0)[0]; }`,
    );
    await fs.writeFile(
      path.join(root, "src", "server.ts"),
      `import "server-only-package";\nexport const serverOnly = true;`,
    );

    try {
      const config = await defineConfig({ root });

      expect(config.optimizeDeps.include).toEqual(
        expect.arrayContaining([
          "react",
          "react-dom/client",
          "@farm.js/core/client",
          "@farm.js/core/plugin/client",
          "@farm.js/core/deferred",
          "@farm.js/core/deployment",
        ]),
      );
      expect(config.optimizeDeps.entries).toEqual(["src/counter.tsx"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
