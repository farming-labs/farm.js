// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

/**
 * A built app's middleware receives a web Request, which has no socket. The
 * Nitro entry rebuilt that Request without the address its server adapter
 * already had, so the default rate-limit bucket (caller address plus path) had
 * nothing to key on and every limited request failed on a directly exposed
 * Node server that did not set trustProxy.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-rate-limit-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app", "limited"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "whoami"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `export default { srcDir: "src", images: { provider: "none" } };`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `export default function HomePage() { return <main>home</main>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "limited", "page.tsx"),
    `export default function LimitedPage() { return <main>limited-page</main>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "limited", "middleware.ts"),
    `
import { middleware } from "@farm.js/core/middleware";

export default middleware().rateLimit({ requests: 2, window: "1m" });
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "whoami", "page.tsx"),
    `export default function WhoAmIPage() { return <main>whoami</main>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "whoami", "middleware.ts"),
    `
export default async function whoami(ctx: any, next: () => Promise<void>) {
  ctx.headers.set("x-client-address", ctx.request.socket?.remoteAddress || "missing");
  await next();
}
`.trim(),
  );

  return root;
}

describe("production middleware client address", () => {
  it("rate limits a directly exposed node server by the connection address", async () => {
    const root = await createFixture();
    let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      expect(config.server?.trustProxy).not.toBe(true);
      await build(config, { root, preset: "node-server" });

      production = await startProductionServer(path.join(root, ".farm", ".output", "server"));

      // The connection's own address, not a forwarded header nobody trusted.
      const whoami = await fetch(`${production.origin}/whoami`, {
        headers: { "x-forwarded-for": "203.0.113.8" },
      });
      expect(whoami.status).toBe(200);
      expect(whoami.headers.get("x-client-address")).toMatch(/^(::ffff:)?127\.0\.0\.1$/);

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(`${production.origin}/limited`);
        await response.arrayBuffer();
        statuses.push(response.status);
      }
      expect(statuses).toEqual([200, 200, 429]);
    } finally {
      await production?.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
