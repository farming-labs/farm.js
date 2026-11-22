// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { startProductionServer } from "./production-server";

/**
 * A page that calls notFound() or throws answers with the not-found or error page, rendered inside
 * the layouts but without the route's layout boundaries and page segment. The production client
 * hydrates the route the document names, so a document that named the route it failed on hydrated
 * that route's layout over the not-found or error page and wiped it (React error #418, then an
 * empty page). Development names no route to hydrate for these documents; production must not
 * either.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  // Newest first, so the server stops before its directory is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-status-document-routes-"));
  cleanups.push(() =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const link = async (name: string, target: string) => {
    const destination = path.join(root, "node_modules", ...name.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.symlink(await fs.realpath(target), destination, "junction");
  };
  await link("@farm.js/core", packageRoot);
  for (const name of ["react", "react-dom"]) {
    await link(name, path.join(packageRoot, "node_modules", name));
  }
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default ${JSON.stringify({
      images: { provider: "none" },
      telemetry: false,
    })};\n`,
    "src/app/layout.tsx": `"use client";
export default function Layout({ children }: { children: unknown }) {
  return <div id="shell">{children as never}</div>;
}
`,
    "src/app/page.tsx": `export default function Home() {
  return <p>home</p>;
}
`,
    "src/app/crops/[name]/page.tsx": `import { notFound } from "@farm.js/core/navigation";
export default function Crop({ params }: { params: { name: string } }) {
  if (params.name !== "wheat") notFound();
  return <h1 id="crop">{params.name}</h1>;
}
`,
    "src/app/broken/page.tsx": `export default function Broken(): never {
  throw new Error("broken page");
}
`,
    "src/app/error.tsx": `export default function ErrorPage() {
  return <h1 id="error">error page</h1>;
}
`,
    "src/app/not-found.tsx": `export default function NotFound() {
  return <h1 id="not-found">not found page</h1>;
}
`,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

/** What the document tells the client to boot with: `window.__FARM_CLIENT_ROUTES__`. */
function readBootRoutes(html: string): { path: string; routes: Array<{ pattern: string }> } | null {
  const match = /window\.__FARM_CLIENT_ROUTES__=(\{.*?\});/.exec(html);
  return match ? JSON.parse(match[1]!) : null;
}

describe("not-found and error documents in a production build", () => {
  it("name no route for the client to hydrate over them", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    cleanups.push(() => server.stop());

    // The route's own page still boots with its route.
    const page = await fetch(`${server.origin}/crops/wheat`);
    expect(page.status).toBe(200);
    expect(readBootRoutes(await page.text())).toEqual({
      path: "/crops/wheat",
      routes: [expect.objectContaining({ pattern: "/crops/[name]" })],
    });

    for (const [pathname, status, marker] of [
      ["/crops/corn", 404, '<h1 id="not-found">not found page</h1>'],
      ["/broken", 500, '<h1 id="error">error page</h1>'],
      ["/no-such-page", 404, '<h1 id="not-found">not found page</h1>'],
    ] as const) {
      const response = await fetch(server.origin + pathname);
      const html = await response.text();
      expect(response.status, pathname).toBe(status);
      expect(html, pathname).toContain(marker);
      // Without entries for its URL the client would load the route table and match the route.
      expect(readBootRoutes(html), pathname).toEqual({ path: pathname, routes: [] });
    }
  }, 240_000);
});
