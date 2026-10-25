// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig, type FarmConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const FILES: Record<string, string> = {
  "src/app/layout.tsx": [
    'export const metadata = { title: "Acme" };',
    "export default function Layout({ children }) { return <main>{children}</main>; }",
  ].join("\n"),
  "src/app/page.tsx": [
    'export const metadata = { title: "Home", description: "Acme builds tools." };',
    "export default function Page() { return <><h1>Home</h1><p>Welcome home.</p></>; }",
  ].join("\n"),
  "src/app/about/page.tsx": [
    'export const metadata = { title: "About us" };',
    "export default function Page() { return <><h1>About us</h1><p>We ship tools.</p></>; }",
  ].join("\n"),
  "src/app/blog/[slug]/page.tsx": "export default function Page() { return <p>post</p>; }",
  "src/app/drafts/page.tsx": [
    "export const metadata = { robots: { index: false } };",
    "export default function Page() { return <p>drafts</p>; }",
  ].join("\n"),
  "src/farm.routes.tsx": [
    'import { createRoute, defineRoutes, redirect } from "@farm.js/core";',
    'export const Account = createRoute("/account", {',
    '  guard() { redirect("/"); },',
    "  component: () => <p>secret account</p>,",
    "});",
    "export default defineRoutes(() => [Account]);",
  ].join("\n"),
};

/** Builds an app for Vercel's Node runtime and returns its request handler. */
async function buildApp(
  root: string,
  config: Partial<FarmConfig>,
  files: Record<string, string> = {},
): Promise<{ fetch(request: Request): Promise<Response> }> {
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(
    path.join(root, "package.json"),
    '{"name":"acme-site","version":"3.1.0","type":"module","private":true}',
  );
  for (const [relativePath, source] of Object.entries({ ...FILES, ...files })) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  const fileConfig = files["farm.config.ts"] ? await loadConfig(root, undefined, "production") : {};
  const resolved = await resolveConfig(
    {
      ...fileConfig,
      root,
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      deploy: { target: "vercel" },
      ...config,
    },
    "production",
  );
  await build(resolved, { root, preset: "vercel" });
  const functionPath = path.resolve(
    root,
    resolved.deploy.outputDir,
    "functions",
    "__nitro.func",
    "index.mjs",
  );
  return (await import(/* @vite-ignore */ pathToFileURL(functionPath).href)).default;
}

function mcp(
  method: string,
  params?: unknown,
  base = "https://acme.test",
  headers: Record<string, string> = {},
) {
  return new Request(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
}

async function withRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-mcp-"));
  try {
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("production default MCP server", () => {
  it("serves the same tools as development and lists them for discovery", async () => {
    await withRoot(async (root) => {
      const handler = await buildApp(root, {});
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const response = await handler.fetch(mcp("tools/call", { name, arguments: args }));
        expect(response.status).toBe(200);
        return ((await response.json()) as { result: any }).result;
      };

      const initialize = await handler.fetch(
        mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {} }),
      );
      expect(((await initialize.json()) as any).result).toMatchObject({
        protocolVersion: "2025-06-18",
        serverInfo: { name: "acme-site", version: "3.1.0" },
      });

      const listed = await call("list_pages");
      expect(listed.structuredContent.pages.map((page: { path: string }) => page.path)).toEqual([
        "/",
        "/about",
      ]);
      expect((await call("read_page", { path: "/about" })).content[0].text).toContain(
        "We ship tools.",
      );
      for (const path of ["/account", "/drafts"]) {
        expect((await call("read_page", { path })).isError).toBe(true);
      }

      expect((await handler.fetch(new Request("https://acme.test/mcp"))).status).toBe(405);

      const catalog = await handler.fetch(
        new Request("https://acme.test/.well-known/ai-catalog.json"),
      );
      expect(((await catalog.json()) as any).entries).toEqual([
        expect.objectContaining({ url: "https://acme.test/mcp/server-card" }),
      ]);
      const card = await handler.fetch(new Request("https://acme.test/mcp/server-card"));
      expect(((await card.json()) as any).remotes).toEqual([
        expect.objectContaining({ url: "https://acme.test/mcp" }),
      ]);
      const llms = await handler.fetch(new Request("https://acme.test/llms.txt"));
      expect(await llms.text()).toContain("(https://acme.test/mcp)");
      const manifest = await handler.fetch(
        new Request("https://acme.test/.well-known/farmjs.json"),
      );
      expect(((await manifest.json()) as any).mcp.servers).toEqual([
        expect.objectContaining({ path: "/mcp", authorization: "none" }),
      ]);
    });
  }, 240_000);

  it("lets an app /mcp page win and turns off with agent.mcp: false", async () => {
    await withRoot(async (root) => {
      const handler = await buildApp(
        root,
        {},
        {
          "src/app/mcp/page.tsx": "export default function Page() { return <p>our mcp page</p>; }",
        },
      );
      expect(await (await handler.fetch(new Request("https://acme.test/mcp"))).text()).toContain(
        "our mcp page",
      );
      const catalog = await handler.fetch(
        new Request("https://acme.test/.well-known/ai-catalog.json"),
      );
      expect(catalog.status).toBe(404);
    });

    await withRoot(async (root) => {
      const handler = await buildApp(root, { agent: { mcp: false } });
      expect((await handler.fetch(mcp("ping"))).status).toBe(404);
    });
  }, 240_000);

  it("serves and reads pages below the base path", async () => {
    await withRoot(async (root) => {
      const handler = await buildApp(root, { basePath: "/base" });
      const request = mcp(
        "tools/call",
        { name: "read_page", arguments: { path: "/base/about" } },
        "https://acme.test/base",
      );
      const read = ((await (await handler.fetch(request)).json()) as any).result;
      expect(read.isError).toBeUndefined();
      expect(read.content[0].text).toContain("We ship tools.");
      const catalog = await handler.fetch(
        new Request("https://acme.test/base/.well-known/ai-catalog.json"),
      );
      expect(((await catalog.json()) as any).entries).toEqual([
        expect.objectContaining({ url: "https://acme.test/base/mcp/server-card" }),
      ]);
    });
  }, 240_000);

  it("leaves pages a path-specific guard covers out of every public listing", async () => {
    await withRoot(async (root) => {
      const handler = await buildApp(
        root,
        {},
        {
          "farm.config.ts": `import { defineIntegration } from "@farm.js/core/integrations";
export default {
  agent: { llmsTxt: true },
  // Guards covering every path name no page, so they hide nothing.
  plugins: [{ name: "acme:observer", runtime: { before() {} } }],
  middleware: [
    { matcher: "/private/:path*", handler: () => new Response("sign in", { status: 401 }) },
    { matcher: "/(.*)", handler: (_ctx, next) => next() },
    { handler: (_ctx, next) => next() },
  ],
  integrations: {
    auth: defineIntegration({
      category: "auth",
      type: "acme-auth",
      instance: {},
      middleware: [
        { matcher: ["/members(.*)"], handler: () => new Response("members", { status: 401 }) },
      ],
    }),
  },
};
`,
          "src/app/private/notes/page.tsx": [
            'export const metadata = { title: "Private notes" };',
            "export default function Page() { return <p>notes</p>; }",
          ].join("\n"),
          "src/app/middleware.ts":
            "export default async function middleware(_ctx, next) { await next(); }",
          "src/app/staff/middleware.ts":
            'export default async function middleware() { return new Response("staff", { status: 401 }); }',
          "src/app/staff/page.tsx": [
            'export const metadata = { title: "Staff roster" };',
            "export default function Page() { return <p>staff</p>; }",
          ].join("\n"),
          "src/app/members/page.tsx": [
            'export const metadata = { title: "Members area" };',
            "export default function Page() { return <p>members</p>; }",
          ].join("\n"),
        },
      );
      const call = async (name: string, args: Record<string, unknown> = {}) =>
        ((await (await handler.fetch(mcp("tools/call", { name, arguments: args }))).json()) as any)
          .result;
      const hidden = ["/private/notes", "/staff", "/members"];
      const titles = ["Private notes", "Staff roster", "Members area"];

      const listed = await call("list_pages");
      expect(listed.structuredContent.pages.map((page: { path: string }) => page.path)).toEqual([
        "/",
        "/about",
      ]);
      for (const query of ["private", "staff", "members"]) {
        expect(JSON.stringify(await call("search_pages", { query }))).not.toMatch(
          /Private notes|Staff roster|Members area/,
        );
      }
      expect(JSON.stringify(await call("search_pages", { query: "about" }))).toContain("/about");

      for (const pathname of ["/sitemap.xml", "/llms.txt", "/llms-full.txt"]) {
        const body = await (
          await handler.fetch(new Request(`https://acme.test${pathname}`))
        ).text();
        for (const value of [...hidden.map((path) => `acme.test${path}`), ...titles]) {
          expect({ pathname, leaks: body.includes(value) ? value : null }).toEqual({
            pathname,
            leaks: null,
          });
        }
        expect(body).toContain("acme.test/about");
      }
    });
  }, 240_000);

  it("keeps the tools of an MCP server behind a path guard out of the public manifest", async () => {
    await withRoot(async (root) => {
      const handler = await buildApp(
        root,
        {},
        {
          "farm.config.ts": `import { _publishFarmMCPCatalog } from "@farm.js/core/api/runtime";
// Stands in for apiMcp({ allowUnauthenticated: true }) servers published at startup.
// The test unpublishes them: the registry is process-wide.
globalThis.__farmTestUnpublish = [];
for (const path of ["/api/guarded-mcp", "/api/open-mcp"]) {
  globalThis.__farmTestUnpublish.push(_publishFarmMCPCatalog(
    { name: path.slice(5), version: "1.0.0", path },
    [{ name: "list_orders_" + path.slice(5, -4), kind: "standalone", readOnlyHint: true }],
    { public: true, schemas: {} },
  ));
}
export default {
  middleware: [
    { matcher: "/api/guarded-mcp", handler: () => new Response("sign in", { status: 401 }) },
  ],
};
`,
        },
      );
      const unpublish = () =>
        ((globalThis as any).__farmTestUnpublish ?? [])
          .splice(0)
          .forEach((done: () => void) => done());
      let manifest: any;
      try {
        manifest = await (
          await handler.fetch(new Request("https://acme.test/.well-known/farmjs.json"))
        ).json();
      } finally {
        unpublish();
      }
      const servers = Object.fromEntries(
        manifest.mcp.servers.map((server: any) => [server.path, server]),
      );
      expect(servers["/api/guarded-mcp"]).toMatchObject({ authorization: "required", tools: [] });
      expect(JSON.stringify(manifest)).not.toContain("list_orders_guarded");
      expect(servers["/api/open-mcp"]).toMatchObject({
        authorization: "none",
        tools: [expect.objectContaining({ name: "list_orders_open" })],
      });
    });
  }, 240_000);

  it("reads pages as a fresh anonymous request through the plugin runtime", async () => {
    await withRoot(async (root) => {
      const handler = await buildApp(
        root,
        {},
        {
          // The documented authorization pattern: a runtime.before hook refuses /internal.
          "farm.config.ts": `import { definePlugin } from "@farm.js/core";
export default {
  agent: { llmsTxt: { title: "Acme" } },
  plugins: [
    definePlugin({
      name: "acme:internal-auth",
      runtime: {
        before({ request }) {
          if (new URL(request.url).pathname.startsWith("/internal")) {
            return new Response("staff only", { status: 401 });
          }
        },
      },
    }),
  ],
};
`,
          "src/app/internal/handbook/page.tsx": [
            'export const metadata = { title: "Handbook" };',
            "export default function Page() { return <p>INTERNAL-HANDBOOK</p>; }",
          ].join("\n"),
          "src/app/whoami/page.tsx": [
            'import { cookies } from "@farm.js/core/headers";',
            'export const metadata = { title: "Who am I" };',
            "export default async function Page() {",
            '  const session = (await cookies()).get("session")?.value ?? "none";',
            "  return <p>session={session}</p>;",
            "}",
          ].join("\n"),
        },
      );
      const call = async (name: string, args: Record<string, unknown>) =>
        (
          (await (
            await handler.fetch(
              mcp("tools/call", { name, arguments: args }, undefined, { cookie: "session=CALLER" }),
            )
          ).json()) as { result: any }
        ).result;

      const direct = await handler.fetch(new Request("https://acme.test/internal/handbook"));
      expect(direct.status).toBe(401);
      const handbook = await call("read_page", { path: "/internal/handbook" });
      expect(handbook.isError).toBe(true);
      expect(JSON.stringify(handbook)).not.toContain("INTERNAL-HANDBOOK");

      const whoami = await call("read_page", { path: "/whoami" });
      expect(whoami.content[0].text).toContain("session=none");
      expect(whoami.content[0].text).not.toContain("CALLER");

      const llmsFull = await handler.fetch(
        new Request("https://acme.test/llms-full.txt", { headers: { cookie: "session=CALLER" } }),
      );
      const full = await llmsFull.text();
      expect(full).not.toContain("INTERNAL-HANDBOOK");
      expect(full).toContain("session=none");
      expect(full).not.toContain("CALLER");
    });
  }, 240_000);
});
