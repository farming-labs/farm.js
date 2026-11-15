// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Alias, UserConfig, ViteDevServer } from "vite";
import { build } from "../build";
import { resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { mergeFarmViteConfig } from "../server/vite-config";
import { farmPlugin } from "../vite";
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

/** The app's Vite config once Farm's plugin config hook has run on it. */
function configureWithFarm(root: string, userConfig: UserConfig): UserConfig {
  const configHook = farmPlugin({ root }).config as (
    config: UserConfig,
    env: { command: "serve"; mode: string },
  ) => unknown;
  configHook(userConfig, { command: "serve", mode: "development" });
  return userConfig;
}

describe("Farm's @ source alias", () => {
  const root = path.resolve("/workspace/apps/docs");
  const farmSourceAlias = { find: "@", replacement: path.join(root, "src") };
  const uiAlias: Alias = {
    find: /^@\/components\/ui\/(.*)$/,
    replacement: "/workspace/packages/ui/src/components/ui/$1",
  };

  it("stays behind an app alias that answers only some @/ imports", () => {
    const config = configureWithFarm(root, { resolve: { alias: [uiAlias] } });

    // Vite uses the first alias that matches: the app's narrower pattern, then Farm's `@`.
    expect(config.resolve?.alias).toEqual([uiAlias, farmSourceAlias]);
  });

  it("gives way to an app alias that answers every @/ import", () => {
    for (const find of [/^@\/(.*)$/, /^@\//, /^@(.*)$/, /^@\/(.*)$/g]) {
      const appAlias = { find, replacement: path.join(root, "$1") };
      const config = configureWithFarm(root, { resolve: { alias: [uiAlias, appAlias] } });

      expect(config.resolve?.alias).toEqual([uiAlias, appAlias]);
      // A global pattern is left ready for Vite's own matching.
      expect(find.lastIndex).toBe(0);
    }

    const config = configureWithFarm(root, { resolve: { alias: { "@": "/elsewhere" } } });
    expect(config.resolve?.alias).toEqual({ "@": "/elsewhere" });
  });

  it("keeps the app's object aliases first", () => {
    const config = configureWithFarm(root, {
      resolve: { alias: { "@/components/ui": "/workspace/packages/ui/src/components/ui" } },
    });

    expect(Object.entries(config.resolve?.alias ?? {})).toEqual([
      ["@/components/ui", "/workspace/packages/ui/src/components/ui"],
      ["@", path.join(root, "src")],
    ]);
    // Production merges the same way.
    const merged = mergeFarmViteConfig(
      { resolve: { alias: { "@": path.join(root, "src") } } },
      { resolve: { alias: { "@/components/ui": "/workspace/packages/ui/src/components/ui" } } },
    );
    expect(Object.keys(merged.resolve?.alias ?? {})).toEqual(["@/components/ui", "@"]);
  });

  it("is not added twice when the hook runs on a config it already merged", () => {
    const config = configureWithFarm(root, { resolve: { alias: [uiAlias] } });
    configureWithFarm(root, config);

    expect(config.resolve?.alias).toEqual([uiAlias, farmSourceAlias]);
  });
});

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

// A monorepo docs app that maps `@/components/ui/*` to a shared UI package and leaves the rest
// of `@/` to Farm. The app has a component at the same `@/` path, which the alias must win over.
async function createDocsApp(): Promise<{ root: string; alias: Alias[] }> {
  const workspace = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "farm-source-alias-")),
  );
  temporaryRoots.add(workspace);
  const root = path.join(workspace, "apps/docs");
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(
    workspace,
    "packages/ui/src/components/ui/callout.tsx",
    `export function Callout() {
  return <aside>shared callout</aside>;
}`,
  );
  await writeModule(
    root,
    "src/components/ui/callout.tsx",
    `export function Callout() {
  return <aside>app callout</aside>;
}`,
  );
  await writeModule(root, "src/lib/greeting.ts", `export const greeting = "hello from src";`);
  await writeModule(
    root,
    "src/app/layout.tsx",
    `export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
  );
  await writeModule(
    root,
    "src/app/page.tsx",
    `import { Callout } from "@/components/ui/callout";
import { greeting } from "@/lib/greeting";
export default function Page() {
  return <main><h1>{greeting}</h1><Callout /></main>;
}`,
  );
  return {
    root,
    alias: [
      {
        find: /^@\/components\/ui\/(.*)$/,
        replacement: path.join(workspace, "packages/ui/src/components/ui/$1"),
      },
    ],
  };
}

describe("an app alias for part of @/", () => {
  it("resolves the same files in development as in production", async () => {
    const { root, alias } = await createDocsApp();

    const server = await createServer({
      root,
      images: { provider: "none" },
      telemetry: false,
      vite: { resolve: { alias } },
    });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const devPage = await fetch(`http://localhost:${address.port}/`, {
      headers: { accept: "text/html" },
    });
    const devHtml = await devPage.text();
    expect(devPage.status).toBe(200);
    expect(devHtml).toContain("<h1>hello from src</h1>");
    expect(devHtml).toContain("<aside>shared callout</aside>");
    await server.close();
    servers.delete(server);

    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        images: { provider: "none" },
        telemetry: false,
        deploy: { target: "vercel" },
        vite: { resolve: { alias } },
      },
      "production",
    );
    await build(config, { root, preset: "vercel" });
    const functionPath = path.resolve(
      root,
      config.deploy.outputDir,
      "functions",
      "__nitro.func",
      "index.mjs",
    );
    const { default: handler } = await import(/* @vite-ignore */ pathToFileURL(functionPath).href);
    const page = await handler.fetch(
      new Request("https://site.test/", { headers: { accept: "text/html" } }),
    );
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("<h1>hello from src</h1>");
    expect(html).toContain("<aside>shared callout</aside>");
  }, 180_000);
});
