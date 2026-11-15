// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// An app without a `src` directory keeps its folders at the project root,
// where Nitro would otherwise scan `middleware/` as server middleware and
// detect `server.ts` as its server entry.
async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-root-src-dir-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "app"), { recursive: true });
  await fs.mkdir(path.join(root, "lib"), { recursive: true });
  await fs.mkdir(path.join(root, "middleware"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
export default {
  srcDir: ".",
  images: { provider: "none" },
};
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "lib", "label.ts"),
    `export const label = "root-src-dir-home";`,
  );
  await fs.writeFile(
    path.join(root, "middleware", "greeting.ts"),
    `import { label } from "@/lib/label";
export default function greeting() { return label; }`,
  );
  await fs.writeFile(
    path.join(root, "server.ts"),
    `import { label } from "@/lib/label";
export default { fetch: () => new Response("nitro-server-entry " + label) };`,
  );
  await fs.writeFile(
    path.join(root, "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "app", "page.tsx"),
    `import greeting from "@/middleware/greeting";
export default function HomePage() { return <main>{greeting()}</main>; }`,
  );

  return root;
}

async function loadFixtureConfig(root: string) {
  const userConfig = await loadConfig(root, undefined, "production");
  return resolveConfig({ ...userConfig, root }, "production");
}

describe("production build without a src directory", () => {
  it("does not bundle root app folders as Nitro handlers", async () => {
    const root = await createFixture();
    let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

    try {
      const config = await loadFixtureConfig(root);
      await build(config, { root, preset: "node-server" });

      const serverDir = path.join(root, ".farm", ".output", "server");
      await expect(fs.readFile(path.join(serverDir, "index.mjs"), "utf8")).resolves.not.toContain(
        "@/lib/label",
      );

      production = await startProductionServer(serverDir);

      const response = await fetch(`${production.origin}/`);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain("<main>root-src-dir-home</main>");
    } finally {
      await production?.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
