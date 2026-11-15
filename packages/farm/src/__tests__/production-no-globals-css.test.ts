// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-no-globals-css-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
export default {
  srcDir: "src",
  images: { provider: "none" },
};
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `"use client";
export default function HomePage() { return <main>no-globals-css-home</main>; }`,
  );

  return root;
}

async function loadFixtureConfig(root: string) {
  const userConfig = await loadConfig(root, undefined, "production");
  return resolveConfig({ ...userConfig, root }, "production");
}

describe("production build without src/app/globals.css", () => {
  it("builds and serves an app that ships no global stylesheet", async () => {
    const root = await createFixture();
    let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

    try {
      const config = await loadFixtureConfig(root);
      await build(config, { root, preset: "node-server" });

      // The stable stylesheet path stays servable even for style-free apps.
      const publicOutputDir = path.join(root, ".farm", ".output", "public");
      await expect(
        fs.readFile(path.join(publicOutputDir, "farm-client.css"), "utf8"),
      ).resolves.toBe("");

      production = await startProductionServer(path.join(root, ".farm", ".output", "server"));

      const response = await fetch(`${production.origin}/`);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain("no-globals-css-home");
    } finally {
      await production?.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
