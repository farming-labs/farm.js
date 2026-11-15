// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { assertFarmDocsAdapterServesNoGuardedPages } from "../docs/adapter";
import type { FarmDocsResolvedConfig } from "../docs/types";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function write(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

/**
 * An app whose docs adapter answers every docs request with what Farm's `isPathGuarded` says
 * about `?probe=`, and `/docs/secret` behind a sign-in middleware.
 */
async function createApp(capabilities?: string[]): Promise<{ root: string; adapter: object }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-adapter-guarded-"));
  temporaryRoots.push(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await write(root, "package.json", '{"type":"module","private":true}');
  await write(
    root,
    "node_modules/fake-docs-adapter/package.json",
    JSON.stringify({
      name: "fake-docs-adapter",
      type: "module",
      exports: { "./server": "./server.js", "./react": "./react.js" },
    }),
  );
  await write(
    root,
    "node_modules/fake-docs-adapter/server.js",
    `export function createFarmDocsRuntimeHandler(config, options) {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/docs")) return null;
    const probe = url.searchParams.get("probe");
    return Response.json({
      receivesGuardCheck: typeof options.isPathGuarded === "function",
      guarded: probe && options.isPathGuarded ? options.isPathGuarded(probe) : null,
    });
  };
}`,
  );
  await write(
    root,
    "node_modules/fake-docs-adapter/react.js",
    "export function hydrateFarmDocs() {}",
  );
  await write(
    root,
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return <main>{children}</main>; }",
  );
  await write(root, "src/app/docs/page.md", "# Docs\n");
  await write(root, "src/app/docs/guide/page.md", "# Guide\n");
  await write(root, "src/app/docs/secret/page.md", "# Launch plan\n");
  await write(
    root,
    "src/app/docs/secret/middleware.ts",
    `export function middleware(request: Request) {
  if (!request.headers.get("cookie")?.includes("session=")) {
    return new Response("sign in", { status: 401 });
  }
}`,
  );
  const adapter = {
    id: "fake",
    protocol: 1,
    server: "fake-docs-adapter/server",
    react: "fake-docs-adapter/react",
    ...(capabilities ? { capabilities } : {}),
  };
  return { root, adapter };
}

async function buildForVercel(root: string, adapter: object): Promise<void> {
  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      deploy: { target: "vercel" },
      docs: { enabled: true, entry: "/docs", contentDir: "src/app/docs", adapter },
    },
    "production",
  );
  await build(config, { root, preset: "vercel" });
}

describe("a docs adapter with guarded pages", () => {
  it("serves them through an adapter that declares guarded-pages, with the live guard check", async () => {
    const { root, adapter } = await createApp(["guarded-pages"]);
    await buildForVercel(root, adapter);

    const functionRoot = path.join(root, ".vercel", "output", "functions", "__nitro.func");
    const { default: handler } = await import(
      /* @vite-ignore */ pathToFileURL(path.join(functionRoot, "index.mjs")).href
    );
    const probe = async (pathname: string) =>
      (
        await handler.fetch(
          new Request(`https://farm.test/docs/guide?probe=${encodeURIComponent(pathname)}`),
        )
      ).json();

    expect(await probe("/docs/secret")).toEqual({ receivesGuardCheck: true, guarded: true });
    expect(await probe("/docs/guide")).toEqual({ receivesGuardCheck: true, guarded: false });
    // The guard decides any path the adapter asks about, not only the pages Farm discovered.
    expect(await probe("/docs/secret/not-a-farm-page")).toEqual({
      receivesGuardCheck: true,
      guarded: true,
    });
    // The page itself still runs its guard before the adapter answers.
    expect((await handler.fetch(new Request("https://farm.test/docs/secret"))).status).toBe(401);
  }, 180_000);

  it("still refuses them with an adapter that does not declare guarded-pages", async () => {
    const { root, adapter } = await createApp();
    await expect(buildForVercel(root, adapter)).rejects.toThrow(
      /Docs pages behind a path guard \(\/docs\/secret\) would be public: .*Upgrade the adapter/,
    );
  }, 180_000);

  it("still refuses them on an edge target, whose snapshot runs no guard", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-adapter-edge-"));
    temporaryRoots.push(root);
    await write(root, "docs/secret.md", "# Launch plan\n");
    const docs = {
      enabled: true,
      entry: "/docs",
      contentDir: path.join(root, "docs"),
      config: {},
      adapter: {
        id: "fake",
        protocol: 1,
        server: "fake/server",
        react: "fake/react",
        capabilities: ["guarded-pages"],
      },
    } as unknown as FarmDocsResolvedConfig;
    const guardsEverything = () => true;

    expect(() =>
      assertFarmDocsAdapterServesNoGuardedPages(docs, { root }, guardsEverything, "node"),
    ).not.toThrow();
    expect(() =>
      assertFarmDocsAdapterServesNoGuardedPages(docs, { root }, guardsEverything, "edge"),
    ).toThrow(/would be public on an edge target/);
  });
});
