// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

/**
 * An app without `app/layout.tsx` can give each route group its own root layout that renders the
 * document. Development decided whether a route's layout renders `<html>` from `app/layout.tsx`
 * alone, so the first request to a group page composed Farm's default shell around the group's
 * own `<html>`: two documents nested in one. Later requests and production were correct.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function startApp(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-group-root-")));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false };`,
    "src/app/(shop)/layout.tsx":
      'export default function Shop({ children }) { return <html lang="en"><body><nav>shop</nav>{children}</body></html>; }',
    "src/app/(shop)/page.tsx": "export default function Home() { return <main>shop home</main>; }",
    "src/app/(admin)/layout.tsx":
      'export default function Admin({ children }) { return <html lang="de"><body><nav>admin</nav>{children}</body></html>; }',
    "src/app/(admin)/admin/page.tsx":
      "export default function Admin() { return <main>admin</main>; }",
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

describe("a route group's own root layout in development", () => {
  it("is the document from the first request", async () => {
    const origin = await startApp();
    for (const [pathname, lang, text] of [
      ["/admin", "de", "admin"],
      ["/", "en", "shop home"],
    ] as const) {
      const html = await (await fetch(`${origin}${pathname}`)).text();
      expect(html.match(/<html[\s>]/g)?.length, pathname).toBe(1);
      expect(html, pathname).toMatch(new RegExp(`<html[^>]*lang="${lang}"`));
      expect(html, pathname).toContain(text);
    }
  }, 120_000);
});
