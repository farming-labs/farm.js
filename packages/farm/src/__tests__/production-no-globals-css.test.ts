// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createFixture(options: { islands?: boolean } = {}): Promise<string> {
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
  images: { provider: "none" },${options.islands ? '\n  experimental: { serverComponents: { mode: "islands" } },' : ""}
};
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  if (options.islands) {
    // A server page around a client component, which renders as an island.
    await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "components", "counter.tsx"),
      `"use client";
export function Counter() { return <button type="button">no-globals-css-island</button>; }`,
    );
    await fs.writeFile(
      path.join(root, "src", "app", "page.tsx"),
      `import { Counter } from "../components/counter";
export default function HomePage() { return <main>no-globals-css-home<Counter /></main>; }`,
    );
  } else {
    await fs.writeFile(
      path.join(root, "src", "app", "page.tsx"),
      `"use client";
export default function HomePage() { return <main>no-globals-css-home</main>; }`,
    );
  }

  return root;
}

async function loadFixtureConfig(root: string) {
  const userConfig = await loadConfig(root, undefined, "production");
  return resolveConfig({ ...userConfig, root }, "production");
}

// An empty stylesheet still holds the first paint and the module scripts for a round trip.
const STYLESHEET_LINK = /<link\b[^>]*\brel="stylesheet"/i;

async function expectStyleFreeDocuments(root: string, islands: boolean): Promise<void> {
  let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

  try {
    const config = await loadFixtureConfig(root);
    await build(config, { root, preset: "node-server" });

    // The stable stylesheet path stays servable even for style-free apps.
    const publicOutputDir = path.join(root, ".farm", ".output", "public");
    await expect(fs.readFile(path.join(publicOutputDir, "farm-client.css"), "utf8")).resolves.toBe(
      "",
    );

    production = await startProductionServer(path.join(root, ".farm", ".output", "server"));

    const response = await fetch(`${production.origin}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("no-globals-css-home");
    if (islands) expect(html).toContain("<f-island");
    expect(html).not.toMatch(STYLESHEET_LINK);

    const missing = await fetch(`${production.origin}/no-such-page`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toMatch(STYLESHEET_LINK);

    // Anything that hardcoded the stable path still gets the empty stylesheet, not a 404.
    const stylesheet = await fetch(`${production.origin}/farm-client.css`);
    expect(stylesheet.status).toBe(200);
    await stylesheet.arrayBuffer();
  } finally {
    await production?.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("production build without src/app/globals.css", () => {
  it("builds and serves an app that ships no global stylesheet, and links none", async () => {
    await expectStyleFreeDocuments(await createFixture(), false);
  }, 180_000);

  it("links no stylesheet from an islands-mode document when the app has no CSS", async () => {
    await expectStyleFreeDocuments(await createFixture({ islands: true }), true);
  }, 180_000);
});
