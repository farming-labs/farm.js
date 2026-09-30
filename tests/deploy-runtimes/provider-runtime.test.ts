import fs from "node:fs/promises";
import { createHash } from "node:crypto";
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

async function installEdgeDocsAdapterFixture(root: string): Promise<void> {
  const adapterRoot = path.join(root, "node_modules", "test-edge-docs-adapter");
  await fs.mkdir(adapterRoot, { recursive: true });
  await fs.writeFile(
    path.join(adapterRoot, "package.json"),
    JSON.stringify(
      {
        name: "test-edge-docs-adapter",
        type: "module",
        exports: {
          "./server": "./server.js",
          "./react": "./react.js",
          "./edge-compiler": "./edge-compiler.js",
        },
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(adapterRoot, "server.js"),
    `import "node:fs";
export const TEST_DOCS_NODE_SERVER_SENTINEL = true;
export function createFarmDocsRuntimeHandler() {
  throw new Error("The Node docs server must not be imported by an edge build.");
}
`,
  );
  await fs.writeFile(
    path.join(adapterRoot, "react.js"),
    `export function hydrateFarmDocs() {}
`,
  );
  await fs.writeFile(
    path.join(adapterRoot, "edge-compiler.js"),
    `const origin = "https://farm-docs-build.invalid";
const response = (body, contentType = "text/plain; charset=utf-8", status = 200) => ({
  status,
  statusText: status === 200 ? "OK" : "Not Found",
  headers: [["content-type", contentType]],
  body,
});

export function compileFarmDocsEdgeManifest(_config, options) {
  const guideMarkdown = "# Worker Guide\\n\\nThis content is precompiled for the Worker runtime.\\n\\ncanonical_url: \\"" + origin + "/docs/edge-guide\\"\\n";
  const guide = {
    title: "Worker Guide",
    url: "/docs/edge-guide",
    content: "Worker Guide This content is precompiled for the Worker runtime.",
    rawContent: guideMarkdown,
    sourcePath: "test-edge-docs:edge-guide",
  };
  return {
    protocol: 1,
    originPlaceholder: origin,
    entry: "/docs",
    apiPath: "/api/docs",
    routes: {
      "/docs": response(
        "<!doctype html><html><body><main>Edge Docs</main><script type=\\"module\\" src=\\"" + options.clientEntry + "\\"></script></body></html>",
        "text/html; charset=utf-8",
      ),
      "/docs/edge-guide": response(
        "<!doctype html><html><body><main>Worker Guide</main><script type=\\"module\\" src=\\"" + options.clientEntry + "\\"></script></body></html>",
        "text/html; charset=utf-8",
      ),
      "/docs/edge-guide.md": response(guideMarkdown, "text/markdown; charset=utf-8"),
      "/llms.txt": response("# Edge Runtime Docs\\n\\nWorker Guide\\n"),
      "/sitemap.xml": response(
        "<?xml version=\\"1.0\\"?><urlset><url><loc>" + origin + "/docs/edge-guide</loc></url></urlset>",
        "application/xml; charset=utf-8",
      ),
      "/robots.txt": response("Sitemap: " + origin + "/sitemap.xml\\n"),
      "/.well-known/agent.json": response(
        JSON.stringify({ name: "Edge Runtime Docs", baseUrl: origin, api: { docs: "/api/docs" } }),
        "application/json; charset=utf-8",
      ),
    },
    navigation: {
      "/docs/edge-guide": response(
        JSON.stringify({ data: { title: "Worker Guide", url: "/docs/edge-guide" } }),
        "application/json; charset=utf-8",
      ),
    },
    api: {
      static: {},
      markdown: { "edge-guide": response(guideMarkdown, "text/markdown; charset=utf-8") },
      empty: response("[]", "application/json; charset=utf-8"),
      post: response(JSON.stringify({ error: "Not Found" }), "application/json; charset=utf-8", 404),
      search: { pages: [guide], search: true, siteTitle: "Edge Runtime Docs", limit: 10 },
    },
  };
}
`,
  );
}

async function createProviderFixture(
  target: "cloudflare" | "netlify",
  options: { docs?: "builtin" | "adapter" } = {},
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
    if (options.docs === "adapter") await installEdgeDocsAdapterFixture(root);
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
import { apiMcp, defineTool } from ${JSON.stringify(path.join(workspaceRoot, "packages", "farm-mcp", "src", "index.ts"))};
import { z } from ${JSON.stringify(path.join(corePackageRoot, "node_modules", "zod", "index.js"))};
import { GET } from "./src/app/api/runtime/route";

export default {
  security: {
    csp: {
      policy: "script-src 'self'; object-src 'none'",
      nonce: true,
    },
  },
  plugins: [
    apiMcp({
      tools: [GET, defineTool({
        name: "whoami",
        inputSchema: z.object({ message: z.string().trim().min(1) }),
        execute: ({ message }, { authorization, signal }) => ({ message, subject: authorization.subject, aborted: signal.aborted }),
      })],
      authorize: ({ request, tools, server }) => {
        if (server.path !== "/api/mcp" || tools[0]?.name !== "get_runtime" || tools[1]?.kind !== "standalone") {
          throw new Error("Missing MCP policy context");
        }
        return {
          subject: "fixture",
          tools: request.headers.get("authorization") === "Bearer denied" ? [] : tools.map(tool => tool.name),
        };
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

export const ssg = true;

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
import { createEndpoint } from "@farm.js/core/api";

export const GET = createEndpoint(
  "/api/runtime",
  {
    method: "GET",
    mcp: { name: "get_runtime", readOnlyHint: true },
  },
  ({ request }) => {
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
  },
);
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
              adapter:
                options.docs === "adapter"
                  ? {
                      id: "test-edge-docs-adapter",
                      protocol: 1,
                      server: "test-edge-docs-adapter/server",
                      react: "test-edge-docs-adapter/react",
                      edgeCompiler: "test-edge-docs-adapter/edge-compiler",
                    }
                  : false,
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

async function expectEdgeDocsRuntime(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  options: { navigation?: boolean } = {},
): Promise<void> {
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

  if (options.navigation) {
    const navigation = await request("/docs/edge-guide", {
      headers: { "x-farm-docs-navigation": "1" },
    });
    expect(navigation.status).toBe(200);
    await expect(navigation.json()).resolves.toMatchObject({
      data: { title: "Worker Guide", url: "/docs/edge-guide" },
    });
  }

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
  expect(html).not.toMatch(/<script\b[^>]*\bnonce\s*=/i);
  const policy = page.headers.get("content-security-policy");
  expect(policy).toContain("script-src 'self'");
  expect(policy).not.toContain("'nonce-");
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/(?:^|\s)src\s*=/i.test(match[1]!)) continue;
    const hash = createHash("sha256").update(match[2]!).digest("base64");
    expect(policy).toContain(`'sha256-${hash}'`);
  }

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

  const native = await request("/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "whoami", arguments: { message: " hello " } },
    }),
  });
  expect(native.status).toBe(200);
  expect((await readMCPResponse(native)).result.structuredContent).toEqual({
    result: { message: "hello", subject: "fixture", aborted: false },
  });

  for (const [method, name] of [
    ["tools/list", "get_runtime"],
    ["tools/call", "get_runtime"],
    ["tools/call", "whoami"],
  ]) {
    const denied = await request("/api/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
        authorization: "Bearer denied",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method,
        params: { name, arguments: { message: "hello" } },
      }),
    });
    expect(denied.status).toBe(200);
    const result = await readMCPResponse(denied);
    if (method === "tools/list") expect(result.result.tools).toEqual([]);
    else expect(result.error).toBeDefined();
  }
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
    const { root, outputDir } = await createProviderFixture("cloudflare", { docs: "builtin" });
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
      await expectEdgeDocsRuntime((requestPath, init) =>
        runtime.dispatchFetch(new URL(requestPath, "https://farm-runtime.test"), init),
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

  it("runs edge-capable adapter docs in the Cloudflare Worker", async () => {
    const { root, outputDir } = await createProviderFixture("cloudflare", { docs: "adapter" });
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
      await expectEdgeDocsRuntime(
        (requestPath, init) =>
          runtime.dispatchFetch(new URL(requestPath, "https://farm-runtime.test"), init),
        { navigation: true },
      );

      const serverEntry = await fs.readFile(
        path.join(workerDirectory, "_virtual_farm-ssr-entry.mjs"),
        "utf8",
      );
      expect(serverEntry).toContain("test-edge-docs:edge-guide");
      expect(serverEntry).not.toContain(path.join(root, "src", "app", "docs"));
      expect(serverEntry).not.toContain("TEST_DOCS_NODE_SERVER_SENTINEL");
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
