import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NetlifyDev } from "@netlify/dev";
import { Miniflare } from "miniflare";
import { afterAll, describe, expect, it } from "vitest";
import { build } from "../../packages/farm/src/build";
import { loadConfig, resolveConfig } from "../../packages/farm/src/config";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const corePackageRoot = path.join(workspaceRoot, "packages", "farm");
const fixtureRoots: string[] = [];

async function createProviderFixture(
  target: "cloudflare" | "netlify",
  options: { docs?: boolean } = {},
): Promise<{
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
  if (options.docs) {
    await fs.mkdir(path.join(root, "src", "app", "docs", "edge-guide"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "app", "docs", "page.md"),
      `---\ntitle: Edge Docs\ndescription: Docs rendered inside workerd.\n---\n\n# Edge Docs\n\nFarm docs on Cloudflare.\n`,
    );
    await fs.writeFile(
      path.join(root, "src", "app", "docs", "edge-guide", "page.md"),
      `---\ntitle: Worker Guide\ndescription: Searchable Worker documentation.\n---\n\n# Worker Guide\n\nThis content is precompiled for the Worker runtime.\n`,
    );
  }
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
import { apiMcp } from ${JSON.stringify(path.join(workspaceRoot, "packages", "farm-mcp", "src", "index.ts"))};

export default {
  plugins: [
    apiMcp({
      allowUnauthenticated: true,
      tools: {
        "GET /api/runtime": { name: "get_runtime", readOnlyHint: true },
      },
    }),
  ],
};
`.trim(),
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

  const userConfig = await loadConfig(root, undefined, "production");
  const config = await resolveConfig(
    {
      ...userConfig,
      root,
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      generateBuildId: () => `${target}-provider-runtime-test`,
      deploy: { target },
      ...(options.docs
        ? {
            docs: {
              adapter: false,
              entry: "/docs",
              nav: { title: "Edge Runtime Docs" },
              search: { provider: "simple", enabled: true, maxResults: 10 },
              llmsTxt: true,
              sitemap: true,
              robots: true,
            },
          }
        : {}),
    },
    "production",
  );
  await build(config, { root, preset: config.deploy.preset });

  return {
    root,
    outputDir: path.resolve(root, config.deploy.outputDir),
  };
}

async function expectEdgeDocsRuntime(request: (path: string) => Promise<Response>): Promise<void> {
  const page = await request("/docs");
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toContain("text/html");
  const html = await page.text();
  expect(html).toContain("Edge Docs");
  expect(html).not.toContain("farm-docs-build.invalid");

  const markdown = await request("/docs/edge-guide.md");
  expect(markdown.status).toBe(200);
  expect(markdown.headers.get("content-type")).toContain("text/markdown");
  const markdownBody = await markdown.text();
  expect(markdownBody).toContain("This content is precompiled for the Worker runtime.");
  expect(markdownBody).toContain('canonical_url: "https://farm-runtime.test/docs/edge-guide"');

  const search = await request("/api/docs?query=worker");
  expect(search.status).toBe(200);
  expect(await search.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ href: "/docs/edge-guide" })]),
  );

  const llms = await request("/llms.txt");
  expect(llms.status).toBe(200);
  expect(await llms.text()).toContain("Worker Guide");

  const sitemap = await request("/sitemap.xml");
  expect(sitemap.status).toBe(200);
  expect(await sitemap.text()).toContain("https://farm-runtime.test/docs/edge-guide");

  const robots = await request("/robots.txt");
  expect(robots.status).toBe(200);
  expect(await robots.text()).toContain("Sitemap: https://farm-runtime.test/sitemap.xml");

  const agent = await request("/.well-known/agent.json");
  expect(agent.status).toBe(200);
  await expect(agent.json()).resolves.toMatchObject({
    name: "Edge Runtime Docs",
    baseUrl: "https://farm-runtime.test",
    api: { docs: "/api/docs" },
  });
}

async function expectProviderRuntime(
  provider: "cloudflare" | "netlify",
  request: (path: string, init?: RequestInit) => Promise<Response>,
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

  const mcp = await request("/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_runtime", arguments: {} },
    }),
  });
  expect(mcp.status, await mcp.clone().text()).toBe(200);
  const payload = await readMCPResponse(mcp);
  expect(payload.result.structuredContent).toEqual({ result: { ok: true, query: null } });
}

async function readMCPResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
    return JSON.parse(text);
  }
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (!data) throw new Error(`Missing MCP SSE data: ${text}`);
  return JSON.parse(data);
}

afterAll(async () => {
  if (process.env.FARM_KEEP_DEPLOY_RUNTIME_FIXTURES === "1") return;
  await Promise.all(fixtureRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("first-class provider runtime output", () => {
  it("runs the Cloudflare Pages output in workerd", async () => {
    const { root, outputDir } = await createProviderFixture("cloudflare", { docs: true });
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
      await expectProviderRuntime("cloudflare", (requestPath, init) =>
        runtime.dispatchFetch(new URL(requestPath, "https://farm-runtime.test"), init),
      );
      await expectEdgeDocsRuntime((requestPath) =>
        runtime.dispatchFetch(new URL(requestPath, "https://farm-runtime.test")),
      );

      const serverEntry = await fs.readFile(
        path.join(workerDirectory, "_virtual_farm-ssr-entry.mjs"),
        "utf8",
      );
      expect(serverEntry).toContain("farm-docs:edge-guide");
      expect(serverEntry).not.toContain(path.join(root, "src", "app", "docs"));
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
      await expectProviderRuntime("netlify", async (requestPath, init) => {
        const response = await runtime.handle(
          new Request(new URL(requestPath, "https://farm-runtime.test"), init),
        );
        return response ?? new Response(null, { status: 404 });
      });
    } finally {
      await runtime.stop();
    }
  }, 180_000);
});
