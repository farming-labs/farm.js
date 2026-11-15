// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("production Markdown pages", () => {
  it("prerenders a page.mdx that exports force-static and keeps the others per request", async () => {
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-markdown-prerender-"));
    let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;
    const write = async (relativePath: string, source: string) => {
      await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
      await fs.writeFile(path.join(root, relativePath), source);
    };

    try {
      await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
      await fs.symlink(
        packageRoot,
        path.join(root, "node_modules", "@farm.js", "core"),
        "junction",
      );
      await write("package.json", '{"type":"module","private":true}');
      await write(
        "src/app/layout.tsx",
        "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
      );
      await write(
        "src/app/docs/installation/page.mdx",
        [
          "---",
          "title: Installation",
          "---",
          'export const dynamic = "force-static";',
          "",
          "# Install the docs",
          "",
          "```ts",
          'export const dynamic = "force-dynamic";',
          "```",
        ].join("\n"),
      );
      await write("src/app/docs/live/page.mdx", "# Rendered per request\n");

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

      const publicDir = path.join(root, ".farm", ".output", "public");
      const artifact = await fs.readFile(
        path.join(publicDir, "docs", "installation", "index.html"),
        "utf8",
      );
      expect(artifact).toContain("Install the docs");
      await expect(fs.access(path.join(publicDir, "docs", "live", "index.html"))).rejects.toThrow();

      production = await startProductionServer(path.join(root, ".farm", ".output", "server"));
      const prerendered = await fetch(`${production.origin}/docs/installation`);
      expect(prerendered.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
      expect(await prerendered.text()).toBe(artifact);

      const live = await fetch(`${production.origin}/docs/live`);
      expect(live.headers.get("cache-control")).toBe("private, no-store");
      expect(await live.text()).toContain("Rendered per request");
    } finally {
      await production?.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 180_000);
});
