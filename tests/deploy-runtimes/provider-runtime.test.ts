import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NetlifyDev } from "@netlify/dev";
import { Miniflare } from "miniflare";
import { afterAll, describe, expect, it } from "vitest";
import { build } from "../../packages/farm/src/build";
import { resolveConfig } from "../../packages/farm/src/config";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const corePackageRoot = path.join(workspaceRoot, "packages", "farm");
const fixtureRoots: string[] = [];

async function createProviderFixture(target: "cloudflare" | "netlify"): Promise<{
  root: string;
  outputDir: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `farm-${target}-runtime-`));
  fixtureRoots.push(root);

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(
    corePackageRoot,
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
  await fs.symlink(
    await fs.realpath(path.join(corePackageRoot, "node_modules", "react")),
    path.join(root, "node_modules", "react"),
    "junction",
  );
  await fs.symlink(
    await fs.realpath(path.join(corePackageRoot, "node_modules", "react-dom")),
    path.join(root, "node_modules", "react-dom"),
    "junction",
  );
  await fs.mkdir(path.join(root, "src", "app", "api", "runtime"), { recursive: true });
  await fs.mkdir(path.join(root, "public"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "stream-tail.tsx"),
    `export default function StreamTail() { return <span data-stream-tail="complete">stream complete</span>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `
import React, { lazy, Suspense } from "react";

const StreamTail = lazy(() =>
  new Promise((resolve) => setTimeout(() => resolve(import("./stream-tail")), 25)),
);

export default function Page() {
  return (
    <main data-provider-runtime=${JSON.stringify(target)}>
      Farm provider runtime
      <Suspense fallback={<span data-stream-tail="pending">stream pending</span>}>
        <StreamTail />
      </Suspense>
    </main>
  );
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "api", "runtime", "route.ts"),
    `
export function GET(request: Request) {
  return Response.json(
    {
      ok: true,
      query: new URL(request.url).searchParams.get("provider"),
    },
    {
      headers: {
        "set-cookie": "farm-runtime=verified; Path=/; HttpOnly; SameSite=Lax",
        "x-farm-runtime": "verified",
      },
    },
  );
}
`.trim(),
  );
  await fs.writeFile(path.join(root, "public", "runtime-marker.txt"), `${target} static asset`);

  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      generateBuildId: () => `${target}-provider-runtime-test`,
      deploy: { target },
    },
    "production",
  );
  await build(config, { root, preset: config.deploy.preset });

  return {
    root,
    outputDir: path.resolve(root, config.deploy.outputDir),
  };
}

async function expectProviderRuntime(
  provider: "cloudflare" | "netlify",
  request: (path: string) => Promise<Response>,
): Promise<void> {
  const page = await request("/");
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toContain("text/html");
  const html = await page.text();
  expect(html).toContain(`data-provider-runtime="${provider}"`);
  expect(html).toContain('data-stream-tail="complete"');

  const api = await request(`/api/runtime?provider=${provider}`);
  expect(api.status, await api.clone().text()).toBe(200);
  expect(api.headers.get("x-farm-runtime")).toBe("verified");
  expect(api.headers.get("set-cookie")).toContain("farm-runtime=verified");
  await expect(api.json()).resolves.toEqual({ ok: true, query: provider });

  const asset = await request("/runtime-marker.txt");
  expect(asset.status).toBe(200);
  await expect(asset.text()).resolves.toBe(`${provider} static asset`);

  const missing = await request("/missing-provider-route");
  expect(missing.status).toBe(404);
}

afterAll(async () => {
  if (process.env.FARM_KEEP_DEPLOY_RUNTIME_FIXTURES === "1") return;
  await Promise.all(fixtureRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("first-class provider runtime output", () => {
  it("runs the Cloudflare Pages output in workerd", async () => {
    const { outputDir } = await createProviderFixture("cloudflare");
    const workerDirectory = path.join(outputDir, "_worker.js");
    const runtime = new Miniflare({
      compatibilityDate: "2026-07-01",
      compatibilityFlags: ["nodejs_compat"],
      modules: true,
      modulesRoot: workerDirectory,
      scriptPath: path.join(workerDirectory, "index.js"),
      assets: {
        directory: outputDir,
        routerConfig: {
          has_user_worker: true,
        },
      },
    });

    try {
      await expectProviderRuntime("cloudflare", (requestPath) =>
        runtime.dispatchFetch(new URL(requestPath, "https://farm-runtime.test")),
      );
    } finally {
      await runtime.dispose();
    }
  }, 180_000);

  it("runs the Netlify output through the Netlify request pipeline", async () => {
    const { root, outputDir } = await createProviderFixture("netlify");
    await fs.writeFile(
      path.join(root, "netlify.toml"),
      `
[build]
publish = "dist"
functions = ${JSON.stringify(path.relative(root, path.join(outputDir, "server")))}
`.trim(),
    );
    const runtime = new NetlifyDev({
      projectRoot: root,
      blobs: { enabled: false },
      database: { enabled: false },
      edgeFunctions: { enabled: false },
      environmentVariables: { enabled: false },
      functions: { enabled: true },
      geolocation: { enabled: false },
      headers: { enabled: true },
      images: { enabled: false },
      redirects: { enabled: true },
      server: { enabled: false },
      staticFiles: { enabled: true },
      skipGitignore: true,
      serverAddress: null,
    });

    try {
      await runtime.start();
      await expectProviderRuntime("netlify", async (requestPath) => {
        const response = await runtime.handle(
          new Request(new URL(requestPath, "https://farm-runtime.test")),
        );
        return response ?? new Response(null, { status: 404 });
      });
    } finally {
      await runtime.stop();
    }
  }, 180_000);
});
