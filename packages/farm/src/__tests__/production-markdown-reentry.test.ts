// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { GUARDED_SOURCE_FILES } from "./fixtures/markdown-guarded-sources";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Requests a built app makes to itself (the Markdown source's anonymous page check, the Markdown
 * mirror's page render, a plugin's call to an app endpoint) called the inner handler directly.
 * Plugin `runtime.before` guards never saw them, and they inherited the caller's request context,
 * so `cookies()` answered with the caller's cookies inside an "anonymous" check.
 */
const FILES: Record<string, string> = {
  "farm.config.ts": `import { definePlugin } from "@farm.js/core";
const signedIn = (request) => (request.headers.get("cookie") || "").includes("session=valid");
export default {
  plugins: [
    definePlugin({
      name: "acme:auth-guard",
      runtime: {
        before({ request }) {
          const { pathname } = new URL(request.url);
          const guarded = pathname === "/internal" || pathname === "/billing" || pathname === "/api/staff/data";
          if (guarded && !signedIn(request)) {
            return new Response("sign in", { status: 302, headers: { location: "/login" } });
          }
        },
      },
    }),
    definePlugin({
      name: "acme:bridge",
      routes: ({ route, api }) => {
        const staffData = api.get("GET", "/api/staff/data");
        return [
          route.get("/api/bridge", {
            handler: (request) =>
              staffData.invoke(new Request(new URL("/api/staff/data", request.url))),
          }),
        ];
      },
    }),
  ],
};
`,
  "src/app/layout.tsx":
    "export default function Layout({ children }) { return <main>{children}</main>; }",
  "src/app/page.tsx": "export default function Page() { return <p>home</p>; }",
  "src/app/internal/page.md": "# Internal\n\nINTERNAL-ONLY-SOURCE\n",
  "src/app/open/page.md": "# Open\n\nOPEN-SOURCE\n",
  "src/app/billing/page.tsx": "export default function Page() { return <p>BILLING-SECRET</p>; }",
  "src/app/about/page.tsx": "export default function Page() { return <p>About Acme</p>; }",
  "src/app/staff/middleware.ts": `import { cookies } from "@farm.js/core/headers";
export async function middleware() {
  if ((await cookies()).get("session")?.value !== "valid") {
    return new Response("sign in", { status: 302, headers: { location: "/login" } });
  }
}
`,
  "src/app/staff/page.md": "# Staff\n\nSTAFF-ONLY-SOURCE\n",
  "src/app/api/staff/data/route.ts": `import { cookies } from "@farm.js/core/headers";
export async function GET() {
  return Response.json({ secret: "STAFF-DATA", session: (await cookies()).get("session")?.value ?? "none" });
}
`,
};

async function buildApp(
  root: string,
  files: Record<string, string> = FILES,
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
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  const resolved = await resolveConfig(
    {
      ...(files["farm.config.ts"] ? await loadConfig(root, undefined, "production") : {}),
      root,
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      deploy: { target: "vercel" },
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

describe("production requests an app makes to itself", () => {
  it("run plugin runtime hooks and get their own request context", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-md-reentry-"));
    try {
      const app = await buildApp(root);
      const get = async (pathname: string, headers: Record<string, string> = {}) => {
        const response = await app.fetch(new Request(`https://acme.test${pathname}`, { headers }));
        return {
          status: response.status,
          cacheControl: response.headers.get("cache-control") ?? "",
          body: await response.text(),
        };
      };
      const signedIn = { cookie: "session=valid" };

      // A plugin guard covers the page, so its source has no public Markdown version.
      expect((await get("/internal")).status).toBe(302);
      const internal = await get("/internal.md");
      expect(internal.status).toBe(404);
      expect(internal.body).not.toContain("INTERNAL-ONLY-SOURCE");
      const open = await get("/open.md");
      expect(open.status).toBe(200);
      expect(open.body).toContain("OPEN-SOURCE");

      // The mirror renders the page through the same plugin guard as the page itself.
      const billing = await get("/billing.md");
      expect(billing.status).toBe(302);
      expect(billing.body).not.toContain("BILLING-SECRET");
      expect((await get("/billing.md", signedIn)).body).toContain("BILLING-SECRET");
      // The mirror reads an identity page body; only the outer response is compressed.
      const about = await app.fetch(
        new Request("https://acme.test/about.md", { headers: { "accept-encoding": "gzip" } }),
      );
      expect(about.status).toBe(200);
      const aboutBody = Buffer.from(await about.arrayBuffer());
      const aboutText =
        about.headers.get("content-encoding") === "gzip"
          ? zlib.gunzipSync(aboutBody).toString("utf8")
          : aboutBody.toString("utf8");
      expect(aboutText).toContain("About Acme");

      // The anonymous check reads its own cookies, not the signed-in caller's.
      expect((await get("/staff", signedIn)).status).toBe(200);
      const staff = await get("/staff.md", signedIn);
      expect(staff.status).toBe(404);
      expect(staff.body).not.toContain("STAFF-ONLY-SOURCE");
      expect(staff.cacheControl).not.toContain("public");

      // A plugin's endpoint call is guarded and scoped as a direct request is.
      expect((await get("/api/staff/data")).status).toBe(302);
      const bridged = await get("/api/bridge", signedIn);
      expect(bridged.body).not.toContain("STAFF-DATA");
      expect(bridged.status).toBe(302);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 240_000);
});

describe("production Markdown sources", () => {
  it("are public only when an anonymous visitor's page render succeeds", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-md-guards-"));
    try {
      const app = await buildApp(root, GUARDED_SOURCE_FILES);
      const get = async (pathname: string, headers: Record<string, string> = {}) => {
        const response = await app.fetch(
          new Request(`https://acme.test${pathname}`, { headers, redirect: "manual" }),
        );
        return {
          status: response.status,
          cacheControl: response.headers.get("cache-control") ?? "",
          contentType: response.headers.get("content-type") ?? "",
          body: await response.text(),
        };
      };
      const signedIn = { cookie: "session=1" };
      const markdown = { accept: "text/markdown" };

      for (const [page, secret] of [
        ["/staff", "STAFF-ONLY-SOURCE"],
        ["/ledger", "LEDGER-ONLY-SOURCE"],
      ]) {
        expect((await get(page)).status).toBe(307);
        expect((await get(page, signedIn)).status).toBe(200);
        for (const headers of [{}, signedIn]) {
          const source = await get(`${page}.md`, headers);
          expect({ page, headers, status: source.status }).toEqual({ page, headers, status: 404 });
          expect(source.body).not.toContain(secret);
          expect(source.cacheControl).not.toContain("public");
          const negotiated = await get(page, { ...headers, ...markdown });
          // The signed-in caller may read the page (its Markdown mirror); nobody gets the
          // source under a shared cache.
          if (headers !== signedIn) expect(negotiated.body).not.toContain(secret);
          expect(negotiated.status).toBe(headers === signedIn ? 200 : 307);
          expect(negotiated.cacheControl).not.toContain("public");
        }
      }

      for (const [pathname, headers] of [
        ["/open.md", {}],
        ["/open.md", signedIn],
        ["/open", markdown],
        ["/open", { ...signedIn, ...markdown }],
      ] as const) {
        const open = await get(pathname, headers);
        expect({ pathname, headers, status: open.status }).toEqual({
          pathname,
          headers,
          status: 200,
        });
        expect(open.contentType).toContain("text/markdown");
        expect(open.cacheControl).toContain("public");
        expect(open.body).toContain("OPEN-SOURCE");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 240_000);
});
