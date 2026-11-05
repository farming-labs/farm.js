// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
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

// A plugin guard that protects /admin. The session comes from runtime.context,
// so the guard also proves the rewrite keeps the original request's context.
const FILES: Record<string, string> = {
  "farm.config.ts": `import { definePlugin } from "@farm.js/core";
export default {
  images: { provider: "none" },
  telemetry: false,
  rewrites: () => [
    { source: "/alias/:path*", destination: "/admin/:path*" },
    { source: "/api/alias/:path*", destination: "/api/admin/:path*" },
  ],
  plugins: [
    definePlugin({
      name: "acme:admin-guard",
      runtime: {
        context({ request }) {
          return { signedIn: (request.headers.get("cookie") ?? "").includes("session=ok") };
        },
        before({ request, ctx }) {
          const { pathname } = new URL(request.url);
          if (/^\\/(api\\/)?admin(\\/|$)/.test(pathname) && !ctx.signedIn) {
            return new Response("guarded", { status: 401 });
          }
        },
      },
    }),
  ],
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <main>{children}</main>; }`,
  "src/app/admin/page/page.tsx": `export default function Page() { return <h1>admin secret</h1>; }`,
  "src/app/api/admin/data/route.ts": `export function GET() { return Response.json({ secret: "admin" }); }`,
};

async function createApp(prefix: string): Promise<string> {
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
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  for (const [relativePath, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

async function expectGuardedRewrites(
  fetchPath: (path: string, init?: RequestInit) => Promise<Response>,
  pathnames: string[],
) {
  const results: Record<string, string> = {};
  for (const pathname of pathnames) {
    const anonymous = await fetchPath(pathname);
    const signedIn = await fetchPath(pathname, { headers: { cookie: "session=ok" } });
    const signedInBody = await signedIn.text();
    results[pathname] =
      `${anonymous.status} ${await anonymous.text()} | ${signedIn.status} ` +
      (signedInBody.includes("admin") ? "served" : signedInBody.slice(0, 40));
  }
  expect(results).toEqual(
    Object.fromEntries(pathnames.map((pathname) => [pathname, "401 guarded | 200 served"])),
  );
}

describe("plugin runtime.before guards run on config rewrite destinations", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-plugin-guard-rewrite-");
    const server = await createServer({ root });
    servers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    // Development does not apply rewrites to unmatched API paths yet.
    await expectGuardedRewrites(
      (pathname, init) => fetch(`${origin}${pathname}`, init),
      ["/admin/page", "/alias/page", "/api/admin/data"],
    );
  }, 120_000);

  it("in production", async () => {
    const root = await createApp("farm-prod-plugin-guard-rewrite-");
    const resolved = await resolveConfig(
      {
        ...(await loadConfig(root, undefined, "production")),
        root,
        srcDir: "src",
        deploy: { target: "vercel" },
      },
      "production",
    );
    await build(resolved, { root, preset: "vercel" });
    const serverEntry = path.resolve(
      root,
      resolved.deploy.outputDir,
      "functions",
      "__nitro.func",
      "index.mjs",
    );
    const handler = (await import(/* @vite-ignore */ pathToFileURL(serverEntry).href)).default;

    await expectGuardedRewrites(
      (pathname, init) => handler.fetch(new Request(`https://acme.test${pathname}`, init)),
      ["/admin/page", "/alias/page", "/api/admin/data", "/api/alias/data"],
    );
  }, 240_000);
});
