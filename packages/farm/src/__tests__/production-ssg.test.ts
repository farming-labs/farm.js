// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createFixture(externalRewriteOrigin?: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-ssg-"));

  await fs.mkdir(path.join(root, "node_modules", "@farmjs"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farmjs", "core"), "dir");
  await fs.mkdir(path.join(root, "src", "app", "static"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "refreshing"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "blog", "[slug]"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "guarded"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "configured"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "forced-dynamic"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "runtime-controlled"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "redirected"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "rewritten"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "request-context-target"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "api", "local"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "app", "rules", "safe"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
import { getCurrentRequest } from "@farmjs/core/request";

export default {
  srcDir: "src",
  images: { provider: "none" },
  middleware: [
    {
      matcher: "/configured",
      async handler(ctx, next) {
        ctx.headers.set("x-configured-middleware", "yes");
        await next();
      },
    },
    {
      matcher: "/request-context-target",
      async handler(ctx, next) {
        const currentUrl = new URL(getCurrentRequest().url);
        ctx.headers.set("x-current-request-pathname", currentUrl.pathname);
        ctx.headers.set("x-current-request-search", currentUrl.search);
        await next();
      },
    },
  ],
  redirects: [
    { source: "/redirected", destination: "/static", statusCode: 307 },
    {
      source: "/redirect-param/[value]",
      destination: "/target/[value]",
      statusCode: 307,
    },
  ],
  rewrites: ${JSON.stringify([
    { source: "/rewritten", destination: "/static" },
    { source: "/rewrite-fallback", destination: "/static" },
    {
      source: "/request-context-source",
      destination: "/request-context-target?destination=yes",
    },
    ...(externalRewriteOrigin
      ? [
          {
            source: "/api/:path*",
            destination: `${externalRewriteOrigin}/fallback/:path*`,
          },
          { source: "/external-rewritten", destination: `${externalRewriteOrigin}/upstream` },
          {
            source: "/external-parts/[...parts]",
            destination: `${externalRewriteOrigin}/upstream/[...parts]`,
          },
        ]
      : []),
  ])},
  routeRules: {
    "/forced-dynamic": { prerender: false, render: "dynamic" },
    "/rules/**": { prerender: false },
    "/rules/safe": { prerender: true, headers: { "x-exact-route-rule": "safe" } },
  },
};
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "static", "page.tsx"),
    `
export const ssg = true;
export default function StaticPage() {
  return <main data-rendered-at={Date.now()}>pure-static-page</main>;
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "request-context-target", "page.tsx"),
    `export default function RequestContextTarget() { return <main>request-context-target</main>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "api", "local", "route.ts"),
    `export function GET() { return Response.json({ source: "local-api" }); }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "refreshing", "page.tsx"),
    `
export const ssg = true;
export const revalidate = 60;
export default function RefreshingPage() {
  return <main data-rendered-at={Date.now()}>refreshing-page</main>;
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "blog", "[slug]", "page.tsx"),
    `
export const ssg = true;
export function getStaticPaths() { return [{ slug: "built" }]; }
export default function BlogPage({ params }) {
  return <main data-rendered-at={Date.now()}>blog-{params.slug}</main>;
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "guarded", "middleware.ts"),
    `
export async function middleware(_request, context) {
  context.headers.set("x-app-middleware", "yes");
}
`.trim(),
  );
  for (const [route, label] of [
    ["guarded", "app-middleware-page"],
    ["configured", "configured-middleware-page"],
    ["forced-dynamic", "dynamic-rule-page"],
    ["redirected", "redirected-page"],
    ["rewritten", "rewritten-page"],
  ]) {
    await fs.writeFile(
      path.join(root, "src", "app", route, "page.tsx"),
      `
export const ssg = true;
export default function Page() {
  return <main data-rendered-at={Date.now()}>${label}</main>;
}
`.trim(),
    );
  }
  await fs.writeFile(
    path.join(root, "src", "app", "runtime-controlled", "page.tsx"),
    `
export const ssg = true;
export const runtime = "node";
export default function RuntimeControlledPage() {
  return <main data-rendered-at={Date.now()}>runtime-controlled-page</main>;
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "rules", "safe", "page.tsx"),
    `
export const ssg = true;
export default function SafeRulePage() {
  return <main data-rendered-at={Date.now()}>safe-rule-page</main>;
}
`.trim(),
  );

  return root;
}

async function createRuntimeSensitiveFixture(kind: "context" | "plugin" | "i18n"): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, `.tmp-production-ssg-${kind}-`));
  await fs.mkdir(path.join(root, "node_modules", "@farmjs"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farmjs", "core"), "dir");
  await fs.mkdir(path.join(root, "src", "app", "sensitive"), { recursive: true });
  if (kind === "i18n") {
    await fs.mkdir(path.join(root, "src", "messages"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "messages", "en.json"), '{"label":"English"}');
    await fs.writeFile(path.join(root, "src", "messages", "fr.json"), '{"label":"French"}');
  }
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "sensitive", "page.tsx"),
    kind === "context"
      ? `
export const ssg = true;
export default function ContextPage() {
  return <main data-rendered-at={Date.now()}>context-{globalThis.__farmTestTenant || "missing"}</main>;
}
`.trim()
      : kind === "plugin"
        ? `
export const ssg = true;
export default function PluginPage() {
  return <main>plugin-page</main>;
}
`.trim()
        : `
export const ssg = true;
export default function I18nPage() {
  return <main>i18n-page</main>;
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    kind === "context"
      ? `
export default {
  srcDir: "src",
  images: { provider: "none" },
  context({ request }) {
    globalThis.__farmTestTenant = request.headers.get("x-tenant") || "public";
    return { tenant: globalThis.__farmTestTenant };
  },
};
`.trim()
      : kind === "plugin"
        ? `
export default {
  srcDir: "src",
  images: { provider: "none" },
  plugins: [{
    name: "runtime-html-test",
    transformHTML(html) {
      return html.replace("plugin-page", "plugin-page-" + Date.now());
    },
  }],
};
`.trim()
        : `
export default {
  srcDir: "src",
  images: { provider: "none" },
  i18n: {
    locales: ["en", "fr"],
    defaultLocale: "en",
    routing: "prefix-always",
    detection: ["url", "cookie", "accept-language"],
  },
};
`.trim(),
  );
  return root;
}

async function loadFixtureConfig(root: string) {
  const userConfig = await loadConfig(root, undefined, "production");
  return resolveConfig({ ...userConfig, root }, "production");
}

async function getAvailablePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function startRewriteUpstream(): Promise<{
  origin: string;
  stop: () => Promise<void>;
}> {
  const server = createHttpServer((request, response) => {
    response.statusCode = 202;
    response.setHeader("content-type", "application/json");
    response.setHeader("x-rewrite-upstream", "yes");
    response.end(
      JSON.stringify({
        pathname: new URL(request.url || "/", "http://upstream.test").pathname,
        search: new URL(request.url || "/", "http://upstream.test").search,
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

async function startProductionServer(
  serverDir: string,
  readinessPath = "/static",
): Promise<{
  origin: string;
  stop: () => Promise<void>;
}> {
  const port = await getAvailablePort();
  const output: string[] = [];
  const child = spawn(process.execPath, [path.join(serverDir, "index.mjs")], {
    cwd: serverDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const origin = `http://127.0.0.1:${port}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited before readiness:\n${output.join("")}`);
    }
    try {
      await fetch(`${origin}${readinessPath}`);
      return {
        origin,
        stop: async () => {
          if (child.exitCode !== null) return;
          child.kill("SIGTERM");
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 2_000);
            child.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        },
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  child.kill("SIGKILL");
  throw new Error(
    `Production server did not become ready: ${String(lastError)}\n${output.join("")}`,
  );
}

function renderedAt(html: string): string {
  const match = html.match(/data-rendered-at="(\d+)"/);
  if (!match) throw new Error(`Missing render marker in HTML:\n${html}`);
  return match[1];
}

describe("production SSG output", () => {
  it("emits and serves pure SSG HTML while keeping revalidated pages dynamic", async () => {
    const upstream = await startRewriteUpstream();
    const root = await createFixture(upstream.origin);
    let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

    try {
      const config = await loadFixtureConfig(root);
      expect(await config.rewrites()).toContainEqual({
        source: "/external-rewritten",
        destination: `${upstream.origin}/upstream`,
      });
      await build(config, { root, preset: "node-server" });

      const publicDir = path.join(root, ".farm", ".output", "public");
      const staticArtifact = await fs.readFile(
        path.join(publicDir, "static", "index.html"),
        "utf8",
      );
      const dynamicArtifact = await fs.readFile(
        path.join(publicDir, "blog", "built", "index.html"),
        "utf8",
      );
      expect(staticArtifact).toContain("pure-static-page");
      expect(dynamicArtifact).toContain("blog-");
      expect(dynamicArtifact).toContain("built");
      await expect(
        fs.readFile(path.join(publicDir, "rules", "safe", "index.html"), "utf8"),
      ).resolves.toContain("safe-rule-page");
      await expect(fs.access(path.join(publicDir, "refreshing", "index.html"))).rejects.toThrow();
      for (const route of [
        "guarded",
        "configured",
        "forced-dynamic",
        "runtime-controlled",
        "redirected",
        "rewritten",
      ]) {
        await expect(fs.access(path.join(publicDir, route, "index.html"))).rejects.toThrow();
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
      production = await startProductionServer(path.join(root, ".farm", ".output", "server"));

      const firstStatic = await fetch(`${production.origin}/static`);
      expect(firstStatic.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
      const firstStaticHtml = await firstStatic.text();
      await new Promise((resolve) => setTimeout(resolve, 25));
      const secondStaticHtml = await fetch(`${production.origin}/static`).then((response) =>
        response.text(),
      );
      expect(renderedAt(firstStaticHtml)).toBe(renderedAt(staticArtifact));
      expect(renderedAt(secondStaticHtml)).toBe(renderedAt(staticArtifact));

      const firstRefreshing = await fetch(`${production.origin}/refreshing`);
      const firstRefreshingHtml = await firstRefreshing.text();
      await new Promise((resolve) => setTimeout(resolve, 25));
      const secondRefreshing = await fetch(`${production.origin}/refreshing`);
      const secondRefreshingHtml = await secondRefreshing.text();
      expect(firstRefreshing.headers.get("cache-control")).toBe(
        "public, s-maxage=60, stale-while-revalidate=300",
      );
      expect(renderedAt(secondRefreshingHtml)).not.toBe(renderedAt(firstRefreshingHtml));

      const firstGuarded = await fetch(`${production.origin}/guarded`);
      expect(firstGuarded.headers.get("x-app-middleware")).toBe("yes");
      const firstGuardedHtml = await firstGuarded.text();
      await new Promise((resolve) => setTimeout(resolve, 25));
      const secondGuardedHtml = await fetch(`${production.origin}/guarded`).then((response) =>
        response.text(),
      );
      expect(renderedAt(secondGuardedHtml)).not.toBe(renderedAt(firstGuardedHtml));

      const firstConfigured = await fetch(`${production.origin}/configured`);
      expect(firstConfigured.headers.get("x-configured-middleware")).toBe("yes");
      const firstConfiguredHtml = await firstConfigured.text();
      await new Promise((resolve) => setTimeout(resolve, 25));
      const secondConfiguredHtml = await fetch(`${production.origin}/configured`).then((response) =>
        response.text(),
      );
      expect(renderedAt(secondConfiguredHtml)).not.toBe(renderedAt(firstConfiguredHtml));

      for (const route of ["forced-dynamic", "runtime-controlled"]) {
        const firstHtml = await fetch(`${production.origin}/${route}`).then((response) =>
          response.text(),
        );
        await new Promise((resolve) => setTimeout(resolve, 25));
        const secondHtml = await fetch(`${production.origin}/${route}`).then((response) =>
          response.text(),
        );
        expect(renderedAt(secondHtml)).not.toBe(renderedAt(firstHtml));
      }

      const redirectResponse = await fetch(`${production.origin}/redirected`, {
        redirect: "manual",
      });
      expect(redirectResponse.status).toBe(307);
      expect(redirectResponse.headers.get("location")).toBe("/static");

      const encodedRedirectResponse = await fetch(
        `${production.origin}/redirect-param/question%3Fhash%23slash%2Fvalue`,
        { redirect: "manual" },
      );
      expect(encodedRedirectResponse.status).toBe(307);
      expect(encodedRedirectResponse.headers.get("location")).toBe(
        "/target/question%3Fhash%23slash%2Fvalue",
      );

      const rewriteResponse = await fetch(`${production.origin}/rewritten?via=config`, {
        redirect: "manual",
      });
      expect(rewriteResponse.status).toBe(200);
      expect(rewriteResponse.headers.get("location")).toBeNull();
      await expect(rewriteResponse.text()).resolves.toContain("rewritten-page");

      const fallbackRewriteResponse = await fetch(
        `${production.origin}/rewrite-fallback?via=config`,
        { redirect: "manual" },
      );
      expect(fallbackRewriteResponse.status).toBe(200);
      expect(fallbackRewriteResponse.headers.get("location")).toBeNull();
      await expect(fallbackRewriteResponse.text()).resolves.toContain("pure-static-page");

      const requestContextRewriteResponse = await fetch(
        `${production.origin}/request-context-source?source=yes`,
      );
      expect(requestContextRewriteResponse.status).toBe(200);
      expect(requestContextRewriteResponse.headers.get("x-current-request-pathname")).toBe(
        "/request-context-target",
      );
      expect(requestContextRewriteResponse.headers.get("x-current-request-search")).toBe(
        "?destination=yes",
      );
      await expect(requestContextRewriteResponse.text()).resolves.toContain(
        "request-context-target",
      );

      const localAPIResponse = await fetch(`${production.origin}/api/local?via=local`);
      expect(localAPIResponse.status).toBe(200);
      await expect(localAPIResponse.json()).resolves.toEqual({ source: "local-api" });

      const localAPIMethodResponse = await fetch(`${production.origin}/api/local`, {
        method: "POST",
      });
      expect(localAPIMethodResponse.status).toBe(405);
      await expect(localAPIMethodResponse.json()).resolves.toEqual({
        error: "Method Not Allowed",
      });

      const fallbackAPIRewriteResponse = await fetch(
        `${production.origin}/api/missing/path?via=fallback`,
      );
      const fallbackAPIRewriteBody = await fallbackAPIRewriteResponse.text();
      expect(fallbackAPIRewriteResponse.status, fallbackAPIRewriteBody).toBe(202);
      expect(JSON.parse(fallbackAPIRewriteBody)).toEqual({
        pathname: "/fallback/missing/path",
        search: "?via=fallback",
      });

      const externalRewriteResponse = await fetch(
        `${production.origin}/external-rewritten?via=config`,
      );
      const externalRewriteBody = await externalRewriteResponse.text();
      expect(externalRewriteResponse.status, externalRewriteBody).toBe(202);
      expect(externalRewriteResponse.headers.get("x-rewrite-upstream")).toBe("yes");
      expect(JSON.parse(externalRewriteBody)).toEqual({
        pathname: "/upstream",
        search: "?via=config",
      });

      const encodedCatchAllRewriteResponse = await fetch(
        `${production.origin}/external-parts/one%3F/two%23/three%2Ffour?via=params`,
      );
      const encodedCatchAllRewriteBody = await encodedCatchAllRewriteResponse.text();
      expect(encodedCatchAllRewriteResponse.status, encodedCatchAllRewriteBody).toBe(202);
      expect(JSON.parse(encodedCatchAllRewriteBody)).toEqual({
        pathname: "/upstream/one%3F/two%23/three%2Ffour",
        search: "?via=params",
      });

      const exactRuleResponse = await fetch(`${production.origin}/rules/safe`);
      expect(exactRuleResponse.headers.get("cache-control")).toBe(
        "public, max-age=0, must-revalidate",
      );
      expect(exactRuleResponse.headers.get("x-exact-route-rule")).toBe("safe");
    } finally {
      await production?.stop();
      await upstream.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps custom request context and runtime plugin SSG routes server-handled", async () => {
    for (const kind of ["context", "plugin", "i18n"] as const) {
      const root = await createRuntimeSensitiveFixture(kind);
      let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

      try {
        const config = await loadFixtureConfig(root);
        await build(config, { root, preset: "node-server" });
        const publicDir = path.join(root, ".farm", ".output", "public");
        const artifactPaths =
          kind === "i18n"
            ? ["en/sensitive/index.html", "fr/sensitive/index.html"]
            : ["sensitive/index.html"];
        for (const artifactPath of artifactPaths) {
          await expect(fs.access(path.join(publicDir, artifactPath))).rejects.toThrow();
        }

        production = await startProductionServer(
          path.join(root, ".farm", ".output", "server"),
          kind === "i18n" ? "/en/sensitive" : "/sensitive",
        );
        if (kind === "context") {
          const tenantAHtml = await fetch(`${production.origin}/sensitive`, {
            headers: { "x-tenant": "tenant-a" },
          }).then((response) => response.text());
          const tenantBHtml = await fetch(`${production.origin}/sensitive`, {
            headers: { "x-tenant": "tenant-b" },
          }).then((response) => response.text());
          expect(tenantAHtml).toContain("tenant-a");
          expect(tenantAHtml).not.toContain("tenant-b");
          expect(tenantBHtml).toContain("tenant-b");
          expect(tenantBHtml).not.toContain("tenant-a");
        } else if (kind === "plugin") {
          const firstHtml = await fetch(`${production.origin}/sensitive`).then((response) =>
            response.text(),
          );
          await new Promise((resolve) => setTimeout(resolve, 25));
          const secondHtml = await fetch(`${production.origin}/sensitive`).then((response) =>
            response.text(),
          );
          expect(firstHtml).toMatch(/plugin-page-\d+/);
          expect(secondHtml).toMatch(/plugin-page-\d+/);
          expect(secondHtml).not.toBe(firstHtml);
        } else {
          const english = await fetch(`${production.origin}/en/sensitive`);
          const french = await fetch(`${production.origin}/fr/sensitive`);
          expect(english.status).toBe(200);
          expect(french.status).toBe(200);
          await expect(english.text()).resolves.toContain("i18n-page");
          await expect(french.text()).resolves.toContain("i18n-page");
        }
      } finally {
        await production?.stop();
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  }, 180_000);
});
