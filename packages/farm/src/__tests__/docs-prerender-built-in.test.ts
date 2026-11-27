// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { logger } from "../utils";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createDocsApp(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-prerender-built-in-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  const all: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "src/app/layout.tsx":
      "export default function Layout({ children }) { return <main>{children}</main>; }",
    "src/app/docs/page.md": "---\ntitle: Docs\nsocialImage: false\n---\n# Docs home\n",
    "src/app/docs/guide/page.md": "---\ntitle: Guide\n---\n# Guide body\n",
    ...files,
  };
  for (const [relativePath, source] of Object.entries(all)) {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, source);
  }
  return root;
}

async function buildDocsApp(
  root: string,
  target: "node" | "vercel",
  docs: Record<string, unknown> = {},
): Promise<void> {
  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      images: { provider: "none" },
      telemetry: false,
      deploy: { target },
      docs: {
        adapter: false,
        entry: "/docs",
        contentDir: "src/app/docs",
        prerender: true,
        ...docs,
      },
    },
    "production",
  );
  await build(config, { root, preset: config.deploy.preset });
}

async function readIfExists(filePath: string): Promise<string | null> {
  return fs.readFile(filePath, "utf8").catch(() => null);
}

interface VercelRoute {
  src?: string;
  dest?: string;
  handle?: string;
  continue?: boolean;
  headers?: Record<string, string>;
  middlewarePath?: string;
  has?: Array<{ type: string; key?: string; value?: string }>;
}

/**
 * The route Vercel ends at before it serves a static file, or null when none matches. As in
 * Vercel's router, `src` matches the whole pathname, a matching route without `continue` ends
 * routing in that phase, and a `has` header condition must match. Its value is anchored here,
 * the stricter reading.
 */
function matchVercelRouteBeforeFilesystem(
  routes: VercelRoute[],
  pathname: string,
  headers: Record<string, string>,
): VercelRoute | null {
  for (const route of routes) {
    if (route.handle === "filesystem") return null;
    if (route.handle || route.middlewarePath || !route.src) continue;
    const src = `${route.src.startsWith("^") ? "" : "^"}${route.src}${route.src.endsWith("$") ? "" : "$"}`;
    if (!new RegExp(src).test(pathname)) continue;
    const hasMatches = (route.has ?? []).every((condition) => {
      const value = headers[condition.key!.toLowerCase()];
      if (condition.type !== "header" || value === undefined) return false;
      return condition.value === undefined || new RegExp(`^(?:${condition.value})$`).test(value);
    });
    if (!hasMatches) continue;
    if (!route.continue) return route;
  }
  return null;
}

describe("docs.prerender with Farm's built-in docs renderer", () => {
  it("prerenders pages whose HTML does not depend on the request's origin", async () => {
    const root = await createDocsApp({});
    const info = vi.spyOn(logger, "info");
    try {
      await buildDocsApp(root, "node");
      const publicDir = path.join(root, ".farm", ".output", "public");

      const home = await readIfExists(path.join(publicDir, "docs", "index.html"));
      expect(home).toContain('id="nd-docs-layout"');
      expect(home).toContain("Docs home");
      // Its og:url and og:image would carry the build's origin: it renders on request.
      expect(await readIfExists(path.join(publicDir, "docs", "guide", "index.html"))).toBeNull();
      expect(info.mock.calls.map(([message]) => String(message))).toContain(
        "↪ Keeping 1 docs page(s) rendering on request: their social image metadata is an absolute URL built from the request's origin. Set docs.socialImage.baseUrl to prerender them.",
      );
    } finally {
      info.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("prerenders every page once socialImage.baseUrl fixes the origin", async () => {
    const root = await createDocsApp({});
    try {
      await buildDocsApp(root, "node", { socialImage: { baseUrl: "https://docs.example.com" } });
      const guide = await readIfExists(
        path.join(root, ".farm", ".output", "public", "docs", "guide", "index.html"),
      );
      expect(guide).toContain("Guide body");
      expect(guide).toContain('content="https://docs.example.com/docs/guide"');
      expect(guide).not.toContain("localhost");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("prerenders sign-in-gated docs on Vercel behind edge middleware", async () => {
    const root = await createDocsApp({
      "src/app/docs/middleware.ts": `export const config = { runtime: "edge" };
export function middleware(request: Request) {
  if (!request.headers.get("cookie")?.includes("session=")) {
    return Response.redirect(new URL("/sign-in", request.url), 307);
  }
}`,
    });
    try {
      await buildDocsApp(root, "vercel", {
        socialImage: { baseUrl: "https://docs.example.com" },
      });
      const outputDir = path.join(root, ".vercel", "output");

      // The build rendered the page, not the guard's redirect.
      const guide = await readIfExists(
        path.join(outputDir, "static", "docs", "guide", "index.html"),
      );
      expect(guide).toContain("Guide body");
      // Its Markdown stays on the server, where the guard's coverage of `.md` decides it.
      expect(await readIfExists(path.join(outputDir, "static", "docs", "guide.md"))).toBeNull();

      const { routes } = JSON.parse(await fs.readFile(path.join(outputDir, "config.json"), "utf8"));
      const middleware = routes.find(
        (route: { middlewarePath?: string }) => route.middlewarePath === "_farm_middleware",
      );
      expect(new RegExp(middleware.src).test("/docs/guide")).toBe(true);
      expect(new RegExp(middleware.src).test("/docs")).toBe(true);
      const guideHeaders = routes.find(
        (route: { src?: string; headers?: Record<string, string> }) =>
          route.headers && route.src && new RegExp(route.src).test("/docs/guide"),
      )?.headers;
      expect(guideHeaders?.["cache-control"]).toBe("private, no-store");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("answers Markdown requests for prerendered pages on Vercel from the server", async () => {
    const root = await createDocsApp({});
    try {
      await buildDocsApp(root, "vercel", {
        socialImage: { baseUrl: "https://docs.example.com" },
      });
      const outputDir = path.join(root, ".vercel", "output");
      expect(
        await readIfExists(path.join(outputDir, "static", "docs", "guide", "index.html")),
      ).toContain("Guide body");

      const { routes } = JSON.parse(await fs.readFile(path.join(outputDir, "config.json"), "utf8"));
      // A browser gets the static file, with the page's own header route.
      const browser = matchVercelRouteBeforeFilesystem(routes, "/docs/guide", {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      });
      expect(browser?.dest).toBeUndefined();
      expect(browser?.headers?.["cache-control"]).toBe("public, max-age=0, must-revalidate");
      expect(matchVercelRouteBeforeFilesystem(routes, "/docs/guide", {})?.dest).toBeUndefined();

      // An agent asking for Markdown reaches the server, ahead of that header route.
      for (const accept of ["text/markdown", "text/markdown, text/html;q=0.9", "text/plain"]) {
        for (const pathname of ["/docs/guide", "/docs"]) {
          expect(
            matchVercelRouteBeforeFilesystem(routes, pathname, { accept })?.dest,
            `${pathname} ${accept}`,
          ).toBe("/__nitro");
        }
      }
      expect(
        matchVercelRouteBeforeFilesystem(routes, "/docs/guide/x", { accept: "text/markdown" }),
      ).toBeNull();

      const { default: handler } = await import(
        /* @vite-ignore */ pathToFileURL(
          path.join(outputDir, "functions", "__nitro.func", "index.mjs"),
        ).href
      );
      const markdown: Response = await handler.fetch(
        new Request("https://docs.example.com/docs/guide", {
          headers: { accept: "text/markdown" },
        }),
      );
      expect(markdown.status).toBe(200);
      expect(markdown.headers.get("content-type")).toContain("text/markdown");
      expect(await markdown.text()).toContain("# Guide body");
      // The server still weighs the header: a refusal gets the HTML page.
      const refused: Response = await handler.fetch(
        new Request("https://docs.example.com/docs/guide", {
          headers: { accept: "text/markdown;q=0, text/html" },
        }),
      );
      expect(refused.headers.get("content-type")).toContain("text/html");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("keeps gated docs on request where the target serves files before middleware", async () => {
    const root = await createDocsApp({
      "src/app/docs/middleware.ts": `export const config = { runtime: "edge" };
export function middleware() { return new Response("sign in", { status: 401 }); }`,
    });
    try {
      await buildDocsApp(root, "node", { socialImage: { baseUrl: "https://docs.example.com" } });
      const publicDir = path.join(root, ".farm", ".output", "public");
      expect(await readIfExists(path.join(publicDir, "docs", "guide", "index.html"))).toBeNull();
      expect(await readIfExists(path.join(publicDir, "docs", "index.html"))).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
