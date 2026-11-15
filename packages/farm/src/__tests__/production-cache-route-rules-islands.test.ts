// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const renderedAt = (body: string) => body.match(/data-at="([^"]+)"/)?.[1];

describe("swr route rules in islands mode", () => {
  it("stores a page whose response varies on F-Layouts", async () => {
    const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-cache-route-rules-islands-"));
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
        "export default function Layout({ children }) { return <div>{children}</div>; }",
      );
      await write(
        "src/app/guide/page.tsx",
        "export default function Guide() { return <main data-at={String(Date.now() + Math.random())}>guide</main>; }",
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          telemetry: false,
          images: { provider: "none" },
          deploy: { target: "node-server" },
          experimental: { serverComponents: true },
          routeRules: { "/guide": { swr: 60 } },
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      production = await startProductionServer(path.join(root, ".farm", ".output", "server"));
      const headers = { accept: "text/html" };
      const first = await fetch(`${production.origin}/guide`, { headers });
      const firstHtml = await first.text();
      const second = await fetch(`${production.origin}/guide`, { headers });
      expect(first.status).toBe(200);
      expect(first.headers.get("vary")).toContain("F-Layouts");
      expect(second.headers.get("x-cache")).toBe("HIT");
      expect(renderedAt(await second.text())).toBe(renderedAt(firstHtml));
    } finally {
      await production?.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 180_000);
});
