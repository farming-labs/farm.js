// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { resolveFarmI18nConfig } from "../i18n/config";
import { createFarmVercelEdgeMiddleware } from "../middleware/vercel-edge";
import { buildFarmVercelRoutes } from "../nitro/vercel-assets";
import { createFarmVercelEdgeMiddlewareRoute } from "../nitro/vercel-edge-middleware";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const signInGuard = {
  middleware(request: Request, context: { headers: Headers }) {
    context.headers.set("x-guard", "ran");
    if (!request.headers.get("cookie")?.includes("session=")) {
      return Response.redirect(new URL("/sign-in", request.url), 307);
    }
  },
};

function edgeMiddleware(module: Record<string, unknown>, basePath = "/") {
  return createFarmVercelEdgeMiddleware({
    modules: [{ path: "/docs", filePath: "/app/docs/middleware.ts", module }],
    // The build passes the app's resolved i18n config, which carries its basePath.
    i18n: resolveConfigI18n(basePath),
    notFoundPath: `${basePath === "/" ? "" : basePath}/__farm/not-found`,
  });
}

function resolveConfigI18n(basePath: string) {
  return resolveFarmI18nConfig(undefined, { basePath });
}

describe("Vercel edge middleware runtime", () => {
  it("answers with the guard's own response, and lets a signed-in request through", async () => {
    const run = edgeMiddleware(signInGuard);

    const signedOut = await run(new Request("https://app.test/docs/guide"));
    expect(signedOut.status).toBe(307);
    expect(signedOut.headers.get("location")).toBe("https://app.test/sign-in");
    expect(signedOut.headers.get("x-middleware-next")).toBeNull();

    const signedIn = await run(
      new Request("https://app.test/docs/guide", { headers: { cookie: "session=1" } }),
    );
    expect(signedIn.headers.get("x-middleware-next")).toBe("1");
    // Headers the middleware set reach the static page's response.
    expect(signedIn.headers.get("x-guard")).toBe("ran");
  });

  it("does not run middleware outside the folder it guards", async () => {
    const response = await edgeMiddleware(signInGuard)(new Request("https://app.test/blog"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-guard")).toBeNull();
  });

  it("routes ctx.rewrite(), notFound() and a failing guard without serving the page", async () => {
    const rewrite = await edgeMiddleware({
      default(ctx: { rewrite(path: string): void }) {
        ctx.rewrite("/docs/other");
      },
    })(new Request("https://app.test/docs/guide?tab=1"));
    // As in the server, the rewrite target is resolved on its own: the query is not carried over.
    expect(rewrite.headers.get("x-middleware-rewrite")).toBe("https://app.test/docs/other");
    expect(rewrite.headers.get("x-middleware-next")).toBeNull();

    const { notFound } = await import("../navigation-errors");
    const missing = await edgeMiddleware(
      {
        default() {
          notFound();
        },
      },
      "/app",
    )(new Request("https://app.test/app/docs/guide"));
    expect(missing.headers.get("x-middleware-rewrite")).toBe(
      "https://app.test/app/__farm/not-found",
    );

    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const failed = await edgeMiddleware({
        default() {
          throw new Error("session store down");
        },
      })(new Request("https://app.test/docs/guide"));
      expect(failed.status).toBe(500);
      expect(failed.headers.get("cache-control")).toBe("private, no-store");
      expect(failed.headers.get("x-middleware-next")).toBeNull();
    } finally {
      console.error = originalError;
    }
    expect(errors).toHaveLength(1);
  });

  it("does not let a middleware drive Vercel's routing through response headers", async () => {
    const response = await edgeMiddleware({
      middleware(_request: Request, context: { headers: Headers }) {
        context.headers.set("x-middleware-rewrite", "https://evil.test/");
      },
    })(new Request("https://app.test/docs/guide"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("Vercel edge middleware route", () => {
  it("covers each guarded page and the file names its static output answers for", () => {
    const route = createFarmVercelEdgeMiddlewareRoute(["/docs/guide", "/"], "/");
    const matches = (pathname: string) => new RegExp(route.src).test(pathname);

    for (const pathname of [
      "/docs/guide",
      "/docs/guide/",
      "/docs/guide/index.html",
      "/docs/guide.html",
      "/",
      "/index.html",
    ]) {
      expect(matches(pathname), pathname).toBe(true);
    }
    for (const pathname of ["/docs/guides", "/docs/guide/x", "/docs", "/other"]) {
      expect(matches(pathname), pathname).toBe(false);
    }
    expect(route).toMatchObject({ middlewarePath: "_farm_middleware", continue: true });
  });

  it("covers a page under the basePath and at the path its static file is written to", () => {
    const route = createFarmVercelEdgeMiddlewareRoute(["/docs/guide"], "/console");
    const matches = (pathname: string) => new RegExp(route.src).test(pathname);
    expect(matches("/console/docs/guide")).toBe(true);
    // Vercel serves the prerendered file at the app path too.
    expect(matches("/docs/guide/index.html")).toBe(true);
    expect(matches("/console/docs/guides")).toBe(false);
    expect(route.middlewareRawSrc).toEqual(["/docs/guide", "/console/docs/guide"]);
  });

  it("runs before Vercel serves static files", () => {
    const middleware = createFarmVercelEdgeMiddlewareRoute(["/docs/guide"]);
    const routes = buildFarmVercelRoutes({
      presetRoutes: [
        { src: "/redirected", status: 307, headers: { Location: "/" } },
        { handle: "filesystem" },
      ],
      runtimeRoutes: [],
      middlewareRoutes: [middleware],
    });
    const middlewareIndex = routes.indexOf(middleware);
    expect(middlewareIndex).toBe(1);
    expect(middlewareIndex).toBeLessThan(
      routes.findIndex((route) => route.handle === "filesystem"),
    );
  });
});

async function createGuardedDocsFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-vercel-edge-middleware-"));
  const write = async (relativePath: string, source: string) => {
    const filePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, source);
  };
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await write("package.json", JSON.stringify({ private: true, type: "module" }));
  await write("farm.config.ts", `export default { srcDir: "src", images: { provider: "none" } };`);
  await write(
    "src/app/layout.tsx",
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await write(
    "src/app/docs/middleware.ts",
    `import { isSignedIn } from "@/lib/session";

export const config = { runtime: "edge" };

export function middleware(request: Request) {
  if (!isSignedIn(request)) {
    return Response.redirect(new URL("/sign-in", request.url), 307);
  }
}`,
  );
  await write(
    "src/lib/session.ts",
    `export function isSignedIn(request: Request): boolean {
  return request.headers.get("cookie")?.includes("session=") ?? false;
}`,
  );
  await write(
    "src/app/docs/guide/page.tsx",
    `export const ssg = true;
export default function Guide() { return <main>edge-guarded-guide</main>; }`,
  );
  // Guarded by middleware that runs in the server: never a public file.
  await write(
    "src/app/admin/middleware.ts",
    `export function middleware() { return new Response("no", { status: 401 }); }`,
  );
  await write(
    "src/app/admin/page.tsx",
    `export const ssg = true;
export default function Admin() { return <main>server-guarded-admin</main>; }`,
  );
  await write(
    "src/app/about/page.tsx",
    `export const ssg = true;
export default function About() { return <main>public-about</main>; }`,
  );
  return root;
}

async function buildFixture(root: string, target: "vercel" | "node-server") {
  const userConfig = await loadConfig(root, undefined, "production");
  const config = await resolveConfig({ ...userConfig, root, deploy: { target } }, "production");
  await build(config, { root, preset: config.deploy.preset });
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

describe('runtime: "edge" middleware in a Vercel build', () => {
  it("prerenders the pages it guards and runs it in front of their static files", async () => {
    const root = await createGuardedDocsFixture();
    try {
      await buildFixture(root, "vercel");
      const outputDir = path.join(root, ".vercel", "output");

      // The build rendered the page itself, not the guard's redirect.
      const guide = await fs.readFile(
        path.join(outputDir, "static", "docs", "guide", "index.html"),
        "utf8",
      );
      expect(guide).toContain("edge-guarded-guide");
      expect(await exists(path.join(outputDir, "static", "about", "index.html"))).toBe(true);
      // Server-run middleware still keeps its page off the static output.
      expect(await exists(path.join(outputDir, "static", "admin", "index.html"))).toBe(false);

      const { routes } = JSON.parse(await fs.readFile(path.join(outputDir, "config.json"), "utf8"));
      const middlewareIndex = routes.findIndex(
        (route: { middlewarePath?: string }) => route.middlewarePath === "_farm_middleware",
      );
      const filesystemIndex = routes.findIndex(
        (route: { handle?: string }) => route.handle === "filesystem",
      );
      expect(middlewareIndex).toBeGreaterThanOrEqual(0);
      expect(middlewareIndex).toBeLessThan(filesystemIndex);
      const middlewareSrc = new RegExp(routes[middlewareIndex].src);
      expect(middlewareSrc.test("/docs/guide")).toBe(true);
      expect(middlewareSrc.test("/docs/guide/index.html")).toBe(true);
      expect(middlewareSrc.test("/about")).toBe(false);
      // No shared cache keeps the guarded page for the next visitor.
      const guideHeaders = routes.find(
        (route: { src?: string; headers?: Record<string, string> }) =>
          route.headers && route.src && new RegExp(route.src).test("/docs/guide"),
      )?.headers;
      expect(guideHeaders?.["cache-control"]).toBe("private, no-store");

      const functionDir = path.join(outputDir, "functions", "_farm_middleware.func");
      expect(
        JSON.parse(await fs.readFile(path.join(functionDir, ".vc-config.json"), "utf8")),
      ).toEqual({
        runtime: "edge",
        entrypoint: "index.js",
      });
      const code = await fs.readFile(path.join(functionDir, "index.js"), "utf8");
      const imports = [...code.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map(
        (match) => match[1],
      );
      expect(
        imports.every((specifier) =>
          /^node:(?:async_hooks|events|buffer|assert|util)$/.test(specifier),
        ),
      ).toBe(true);
      // The server-run middleware is not in the edge function.
      expect(code).not.toContain("server-guarded-admin");

      const { default: middleware } = await import(
        pathToFileURL(path.join(functionDir, "index.js")).href
      );
      const signedOut: Response = await middleware(new Request("https://app.test/docs/guide"));
      expect(signedOut.status).toBe(307);
      expect(signedOut.headers.get("location")).toBe("https://app.test/sign-in");
      const signedIn: Response = await middleware(
        new Request("https://app.test/docs/guide", { headers: { cookie: "session=1" } }),
      );
      expect(signedIn.headers.get("x-middleware-next")).toBe("1");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("changes nothing on a target that serves static files before middleware", async () => {
    const root = await createGuardedDocsFixture();
    try {
      await buildFixture(root, "node-server");
      const publicDir = path.join(root, ".farm", ".output", "public");
      expect(await exists(path.join(publicDir, "about", "index.html"))).toBe(true);
      expect(await exists(path.join(publicDir, "docs", "guide", "index.html"))).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("stops the build when edge middleware imports a Node module the Edge runtime lacks", async () => {
    const root = await createGuardedDocsFixture();
    try {
      await fs.writeFile(
        path.join(root, "src", "lib", "session.ts"),
        `import { readFileSync } from "node:fs";
export function isSignedIn(request: Request): boolean {
  return readFileSync("/tmp/sessions", "utf8").includes(request.headers.get("cookie") ?? "-");
}`,
      );
      await expect(buildFixture(root, "vercel")).rejects.toThrow(
        /does not provide these Node modules:\n {2}- node:fs \(imported by .*session\.ts\)/,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
