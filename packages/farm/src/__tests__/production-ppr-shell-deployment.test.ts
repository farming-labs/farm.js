// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer } from "./production-server";

// A PPR shell is HTML one deployment rendered: it embeds that deployment's ID (deployment skew
// protection) and links that build's client assets. A shared cache adapter, such as Redis,
// outlives a deployment, and every deployment of a rolling update reads it. The shell key named
// no deployment, so the next deployment served the previous one's shell: a document whose
// inline ID and asset links were the old build's, under a header naming the new one, until the
// shell expired (24 hours without revalidate).

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const devServers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...devServers].map((server) => server.close()));
  devServers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

/** A cache adapter on a directory both deployments share, as Redis would be. */
function farmConfig(deploymentId: string, cacheDirectory: string): string {
  return `import fs from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "@farm.js/core";
import { storageCacheAdapter } from "@farm.js/core/cache";

const directory = ${JSON.stringify(cacheDirectory)};
const file = (key) => path.join(directory, encodeURIComponent(key));
const storage = {
  async getItem(key) {
    try {
      return JSON.parse(await fs.readFile(file(key), "utf8"));
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file(key), JSON.stringify(value));
  },
  async removeItem(key) {
    await fs.rm(file(key), { force: true });
  },
};

export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  experimental: { ppr: true },
  deploymentId: ${JSON.stringify(deploymentId)},
  cache: { adapter: storageCacheAdapter(storage) },});
`;
}

/**
 * The development server stores the static part of a page with a dynamic Suspense hole; the
 * production server stores a page that renders whole.
 */
const PAGES = {
  development: `import { Suspense } from "react";
async function Late() {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return <p>late</p>;
}
export const experimental_ppr = true;
export default function Page() {
  return <main>SHELL<Suspense fallback={<p>loading</p>}><Late /></Suspense></main>;
}`,
  production:
    "export const experimental_ppr = true;\nexport default function Page() { return <main>SHELL</main>; }",
};

async function createApp(
  mode: keyof typeof PAGES,
): Promise<{ root: string; cacheDirectory: string }> {
  const prefix = `farm-${mode}-ppr-deployment-`;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
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
    "src/app/layout.tsx":
      "export default function Layout({ children }) { return <div id='app'>{children}</div>; }",
    "src/app/shell/page.tsx": PAGES[mode],
  };
  for (const [file, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return { root, cacheDirectory: path.join(root, "shared-cache") };
}

async function visitShell(origin: string) {
  const response = await fetch(`${origin}/shell`, { headers: { accept: "text/html" } });
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain("SHELL");
  return {
    ppr: response.headers.get("x-farm-ppr"),
    header: response.headers.get("x-farm-deployment-id"),
    embedded: /window\.__FARM_DEPLOYMENT_ID__\s*=\s*"([^"]*)"/.exec(html)?.[1],
  };
}

async function storedEntries(cacheDirectory: string): Promise<number> {
  const files = await fs.readdir(cacheDirectory).catch(() => [] as string[]);
  return files.filter((file) => file.includes("entry")).length;
}

/**
 * The development server stores a shell once its render completes, which can be after the
 * response; wait for the adapter to hold the new entry before asking for the page again.
 */
async function waitForStoredShell(cacheDirectory: string, before: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while ((await storedEntries(cacheDirectory)) <= before) {
    if (Date.now() > deadline) throw new Error("The PPR shell was never stored");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Two deployments in turn, sharing the cache adapter's directory. */
async function expectEachDeploymentServesItsOwnShell(
  cacheDirectory: string,
  serve: (deploymentId: string, check: (origin: string) => Promise<void>) => Promise<void>,
): Promise<void> {
  // The next deployment renders its own shell instead of serving release-1's, then reuses it.
  for (const deploymentId of ["release-1", "release-2"]) {
    await serve(deploymentId, async (origin) => {
      const before = await storedEntries(cacheDirectory);
      expect(await visitShell(origin), deploymentId).toEqual({
        ppr: "miss",
        header: deploymentId,
        embedded: deploymentId,
      });
      await waitForStoredShell(cacheDirectory, before);
      expect(await visitShell(origin), deploymentId).toEqual({
        ppr: "hit",
        header: deploymentId,
        embedded: deploymentId,
      });
    });
  }
}

// Development first: a production build in this process switches React to its production build.
describe("PPR shells in a shared cache across deployments", () => {
  it("in development", async () => {
    const { root, cacheDirectory } = await createApp("development");
    await expectEachDeploymentServesItsOwnShell(cacheDirectory, async (deploymentId, check) => {
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        farmConfig(deploymentId, cacheDirectory),
      );
      const server = await createServer({ root });
      devServers.add(server);
      await server.listen(await getAvailablePort());
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Missing dev server address");
      try {
        await check(`http://localhost:${address.port}`);
      } finally {
        await server.close();
        devServers.delete(server);
      }
    });
  }, 120_000);

  it("in a node-server production build", async () => {
    const { root, cacheDirectory } = await createApp("production");
    await expectEachDeploymentServesItsOwnShell(cacheDirectory, async (deploymentId, check) => {
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        farmConfig(deploymentId, cacheDirectory),
      );
      const config = await resolveConfig(
        { ...(await loadConfig(root, undefined, "production")), root },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
      try {
        await check(server.origin);
      } finally {
        await server.stop();
      }
    });
  }, 240_000);
});
