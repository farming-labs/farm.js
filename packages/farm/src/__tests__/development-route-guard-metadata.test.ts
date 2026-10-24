// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

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

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

async function createProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-guard-metadata-"));
  temporaryRoots.add(root);

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  for (const dependency of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", dependency)),
      path.join(root, "node_modules", dependency),
      "junction",
    );
  }
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(
    root,
    "src/app/layout.tsx",
    `import React from "react";
export const metadata = { title: "layout-title" };
export default function Layout({ children }) {
  return <html><body>{children}</body></html>;
}`,
  );
  await writeModule(
    root,
    "src/farm.routes.tsx",
    `import React from "react";
import { createRoute, defineRoutes, notFound } from "@farm.js/core";

export const Guarded = createRoute("/guarded/[id]", {
  guard() {
    notFound();
  },
  generateMetadata({ params }) {
    return { title: "guarded-private-title-" + params.id, description: "guarded-private-description" };
  },
  notFound: () => <main>guarded-not-found</main>,
  component: () => <main>guarded-content</main>,
});

export const GuardError = createRoute("/guard-error", {
  guard() {
    throw new Error("guard-refused");
  },
  generateMetadata() {
    return { title: "guard-error-private-title" };
  },
  error: () => <main>guard-error-view</main>,
  component: () => <main>guard-error-content</main>,
});

export const Open = createRoute("/open/[id]", {
  generateMetadata({ params }) {
    return { title: "open-title-" + params.id };
  },
  component: () => <main>open-content</main>,
});

export default defineRoutes(() => [Guarded, GuardError, Open]);`,
  );
  return root;
}

describe("development route guard metadata", () => {
  it("does not run the route's generateMetadata when its guard rejects", async () => {
    const root = await createProject();
    const server = await createServer({ root, images: { provider: "none" } });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    const guarded = await fetch(`${origin}/guarded/42`);
    expect(guarded.status).toBe(404);
    const guardedHtml = await guarded.text();
    expect(guardedHtml).toContain("guarded-not-found");
    expect(guardedHtml).toContain("<title>layout-title</title>");
    expect(guardedHtml).not.toContain("guarded-private");

    const failed = await fetch(`${origin}/guard-error`);
    expect(failed.status).toBe(500);
    const failedHtml = await failed.text();
    expect(failedHtml).toContain("guard-error-view");
    expect(failedHtml).not.toContain("guard-error-private-title");

    const open = await fetch(`${origin}/open/7`);
    expect(open.status).toBe(200);
    await expect(open.text()).resolves.toContain("<title>open-title-7</title>");
  }, 60_000);
});
