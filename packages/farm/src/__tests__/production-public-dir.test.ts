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
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-public-dir-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.mkdir(path.join(root, "static", "nested"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
export default {
  srcDir: "src",
  images: { provider: "none" },
  publicDir: "static",
};
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `export default function HomePage() { return <main>custom-public-dir-home</main>; }`,
  );
  await fs.writeFile(path.join(root, "static", "hello.txt"), "hello-from-custom-public-dir");
  await fs.writeFile(path.join(root, "static", "nested", "data.json"), '{"ok":true}');

  return root;
}

async function loadFixtureConfig(root: string) {
  const userConfig = await loadConfig(root, undefined, "production");
  return resolveConfig({ ...userConfig, root }, "production");
}

describe("production build with a custom publicDir", () => {
  it("emits configured publicDir assets into the client output and serves them", async () => {
    const root = await createFixture();
    let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

    try {
      const config = await loadFixtureConfig(root);
      expect(config.publicDir).toBe("static");
      await build(config, { root, preset: "node-server" });

      const publicOutputDir = path.join(root, ".farm", ".output", "public");
      await expect(fs.readFile(path.join(publicOutputDir, "hello.txt"), "utf8")).resolves.toBe(
        "hello-from-custom-public-dir",
      );
      await expect(
        fs.readFile(path.join(publicOutputDir, "nested", "data.json"), "utf8"),
      ).resolves.toBe('{"ok":true}');

      production = await startProductionServer(path.join(root, ".farm", ".output", "server"));

      const assetResponse = await fetch(`${production.origin}/hello.txt`);
      expect(assetResponse.status).toBe(200);
      await expect(assetResponse.text()).resolves.toBe("hello-from-custom-public-dir");

      const nestedResponse = await fetch(`${production.origin}/nested/data.json`);
      expect(nestedResponse.status).toBe(200);
      await expect(nestedResponse.json()).resolves.toEqual({ ok: true });
    } finally {
      await production?.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
