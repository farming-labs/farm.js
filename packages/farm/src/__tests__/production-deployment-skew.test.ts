// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { isFarmDeploymentMismatchResponse } from "../deployment";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

// Deployment skew protection (docs: Deployment, rolling deployment safety). A document names its
// deployment in an inline script, the x-farm-deployment-id header, and an HttpOnly deployment
// cookie; a page request from a browser holding another deployment's page (a navigation fetch
// naming it in its header, a form post carrying its cookie) is refused with a 409 before anything
// runs. The universal production build sent neither header nor cookie and never refused one.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const devServers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...devServers].map((server) => server.close()));
  devServers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

// Counts the page renders, so a refused request shows that nothing ran for it.
const RENDER_COUNTER = `(globalThis as any).__farmSkewRenders = ((globalThis as any).__farmSkewRenders ?? 0) + 1;`;

const FILES: Record<string, string> = {
  "farm.config.ts": `import { defineConfig } from "@farm.js/core";
export default defineConfig({
  telemetry: false,
  images: { provider: "none" },
  deploymentId: "release-2",
  basePath: "/console",
  routeRules: { "/swr/**": { swr: 60 } },
  docs: { enabled: true, entry: "/docs", contentDir: "docs", adapter: false },
  headers: () => [
    { source: "/shared", headers: [{ key: "cache-control", value: "public, s-maxage=600" }] },
  ],
});
`,
  "docs/guide.md": "---\ntitle: Guide\n---\n# Guide\n",
  "src/app/layout.tsx":
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  "src/app/page.tsx": `export const dynamic = "force-dynamic";
export default function Home() {
  ${RENDER_COUNTER}
  return <main>HOME</main>;
}`,
  "src/app/report/page.tsx":
    "export const revalidate = 60;\nexport default function Page() { return <main>REPORT</main>; }",
  "src/app/static/page.tsx":
    "export const ssg = true;\nexport default function Page() { return <main>STATIC</main>; }",
  "src/app/shared/page.tsx":
    'export const dynamic = "force-dynamic";\nexport default function Page() { return <main>SHARED</main>; }',
  "src/app/swr/page/page.tsx":
    'export const dynamic = "force-dynamic";\nexport default function Page() { return <main>SWR</main>; }',
  "src/app/api/renders/route.ts": `export function GET() {
  return Response.json({ renders: (globalThis as any).__farmSkewRenders ?? 0 });
}
export function POST() {
  return Response.json({ ok: true });
}`,
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
  for (const [file, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  return root;
}

const STALE = "release-1";
const CURRENT = "release-2";
const COOKIE = `__farm_deployment=${CURRENT}; Path=/console; HttpOnly; SameSite=Lax`;

async function renders(origin: string): Promise<number> {
  return (await (await fetch(`${origin}/api/renders`)).json()).renders;
}

/** What farm dev and a production build answer alike. */
async function expectDeploymentSkewContract(origin: string): Promise<void> {
  // A document names its deployment and stores it in the deployment cookie, below the basePath.
  const page = await fetch(`${origin}/console`, { headers: { accept: "text/html" } });
  const html = await page.text();
  expect({
    status: page.status,
    deployment: page.headers.get("x-farm-deployment-id"),
    cookies: page.headers.getSetCookie(),
  }).toEqual({ status: 200, deployment: CURRENT, cookies: [COOKIE] });
  expect(html).toContain("HOME");
  expect(html).toMatch(/window\.__FARM_DEPLOYMENT_ID__\s*=\s*"release-2"/);

  // A navigation fetch from a page of the current deployment gets the page, cookie included.
  const current = await fetch(`${origin}/console`, {
    headers: { accept: "text/html", "x-farm-deployment-id": CURRENT },
  });
  expect(current.status).toBe(200);
  expect(current.headers.getSetCookie()).toEqual([COOKIE]);
  await current.body?.cancel();

  // A navigation fetch from another deployment's page is refused: the client reloads the
  // document instead of swapping in markup its bundle may not match. The page does not render,
  // and the stale page's cookie is not moved to this deployment.
  const rendersBefore = await renders(origin);
  const staleNavigation = await fetch(`${origin}/console`, {
    headers: { accept: "text/html", "x-farm-deployment-id": STALE },
  });
  expect(isFarmDeploymentMismatchResponse(staleNavigation, STALE)).toBe(true);
  expect({
    status: staleNavigation.status,
    cacheControl: staleNavigation.headers.get("cache-control"),
    deployment: staleNavigation.headers.get("x-farm-deployment-id"),
    mismatch: staleNavigation.headers.get("x-farm-deployment-mismatch"),
    cookies: staleNavigation.headers.getSetCookie(),
    body: await staleNavigation.json(),
  }).toEqual({
    status: 409,
    cacheControl: "no-store",
    deployment: CURRENT,
    mismatch: "1",
    cookies: [],
    body: {
      error: "FARM_DEPLOYMENT_MISMATCH",
      message: "The application deployment changed. Refresh before retrying this request.",
    },
  });

  // A form posted to a page without JavaScript carries the deployment cookie: a stale one is
  // refused before the page or an action runs.
  const stalePost = await fetch(`${origin}/console`, {
    method: "POST",
    headers: {
      accept: "text/html",
      cookie: `__farm_deployment=${STALE}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "seat=12A",
  });
  expect(stalePost.status).toBe(409);
  expect(stalePost.headers.get("x-farm-deployment-mismatch")).toBe("1");
  await stalePost.body?.cancel();
  expect(await renders(origin)).toBe(rendersBefore);

  // A document load reads no cookie (it may come from a new tab), so it renders and moves the
  // cookie to this deployment.
  const reload = await fetch(`${origin}/console`, {
    headers: { accept: "text/html", cookie: `__farm_deployment=${STALE}` },
  });
  expect(reload.status).toBe(200);
  expect(reload.headers.getSetCookie()).toEqual([COOKIE]);
  await reload.body?.cancel();

  // API routes are not pages: a stale cookie does not refuse them.
  const api = await fetch(`${origin}/api/renders`, {
    method: "POST",
    headers: { cookie: `__farm_deployment=${STALE}` },
  });
  expect(api.status).toBe(200);
  expect(api.headers.get("x-farm-deployment-id")).toBeNull();
  expect(api.headers.getSetCookie()).toEqual([]);
  await api.body?.cancel();
}

/**
 * A response a shared cache may keep never sets the cookie: a CDN does not cache a response that
 * sets one, and one that did would hand it to every visitor. The document still names its
 * deployment, so a navigation from another deployment's page is still detected.
 */
async function expectSharedCachePagesKeepCaching(origin: string): Promise<void> {
  const responses: Record<string, unknown> = {};
  for (const pathname of ["/console/report", "/console/shared", "/console/swr/page"]) {
    const response = await fetch(`${origin}${pathname}`, { headers: { accept: "text/html" } });
    responses[pathname] = {
      status: response.status,
      deployment: response.headers.get("x-farm-deployment-id"),
      cookies: response.headers.getSetCookie(),
      shared: !/private|no-store/.test(response.headers.get("cache-control") ?? ""),
    };
    await response.body?.cancel();
  }
  const shared = { status: 200, deployment: CURRENT, cookies: [], shared: true };
  expect(responses).toEqual({
    "/console/report": shared,
    "/console/shared": shared,
    "/console/swr/page": shared,
  });

  // A browser that loaded a dynamic page holds the deployment cookie and sends it with every
  // later request. It names a release, not a visitor, so on its own it keeps a shared page
  // shared, as a request without cookies is; any other cookie still makes the page private.
  const [deploymentCookie] = (
    await fetch(`${origin}/console`, { headers: { accept: "text/html" } }).then(async (page) => {
      await page.body?.cancel();
      return page.headers.getSetCookie();
    })
  ).map((cookie) => cookie.split(";")[0]!);
  expect(deploymentCookie).toBe(`__farm_deployment=${CURRENT}`);
  const cacheControlWith = async (cookie: string) => {
    const response = await fetch(`${origin}/console/report`, {
      headers: { accept: "text/html", cookie },
    });
    await response.body?.cancel();
    return response.headers.get("cache-control");
  };
  expect({
    deploymentOnly: await cacheControlWith(deploymentCookie!),
    staleDeploymentOnly: await cacheControlWith(`__farm_deployment=${STALE}`),
    withVisitorCookie: await cacheControlWith(`${deploymentCookie}; session=abc`),
    visitorCookieFirst: await cacheControlWith(`session=abc; ${deploymentCookie}`),
  }).toEqual({
    deploymentOnly: "public, s-maxage=60, stale-while-revalidate=300",
    staleDeploymentOnly: "public, s-maxage=60, stale-while-revalidate=300",
    withVisitorCookie: "private, no-store",
    visitorCookieFirst: "private, no-store",
  });

  // A prerendered page is a file: it embeds its deployment and sets no cookie.
  const prerendered = await fetch(`${origin}/console/static`, {
    headers: { accept: "text/html" },
  });
  const html = await prerendered.text();
  expect(prerendered.status).toBe(200);
  expect(html).toContain("STATIC");
  expect(html).toContain('window.__FARM_DEPLOYMENT_ID__="release-2"');
  expect(prerendered.headers.getSetCookie()).toEqual([]);
}

/**
 * A docs engine page and the not-found page are page documents too: each names its deployment
 * and follows the cookie and refusal rules of any other page, so a navigation from another
 * deployment's page to either is detected and a stale page's forms stay refused.
 */
async function expectDocsAndNotFoundPagesNameDeployment(
  origin: string,
  mode: "development" | "production",
): Promise<void> {
  for (const [pathname, status, marker] of [
    ["/console/docs/guide", 200, "Guide"],
    ["/console/missing", 404, "404"],
  ] as const) {
    // As for other pages, the development server sets the deployment cookie on every GET page,
    // and production only on one that stays out of shared caches: a visitor's cookie makes the
    // docs page private, while an anonymous docs page and the not-found page are not.
    for (const cookie of ["session=abc", undefined]) {
      const page = await fetch(`${origin}${pathname}`, {
        headers: { accept: "text/html", ...(cookie ? { cookie } : {}) },
      });
      const keptPrivate = /private|no-store/.test(page.headers.get("cache-control") ?? "");
      expect(
        {
          status: page.status,
          deployment: page.headers.get("x-farm-deployment-id"),
          cookies: page.headers.getSetCookie().filter((value) => value.startsWith("__farm")),
        },
        `${pathname} ${cookie ?? "anonymous"}`,
      ).toEqual({
        status,
        deployment: CURRENT,
        cookies: mode === "development" || keptPrivate ? [COOKIE] : [],
      });
      if (mode === "production" && pathname === "/console/docs/guide" && cookie) {
        expect(keptPrivate).toBe(true);
      }
      expect(await page.text(), pathname).toContain(marker);
    }

    // A navigation fetch from another deployment's page is refused, and its cookie stays.
    const staleNavigation = await fetch(`${origin}${pathname}`, {
      headers: { accept: "text/html", "x-farm-deployment-id": STALE },
    });
    expect(
      {
        status: staleNavigation.status,
        mismatch: staleNavigation.headers.get("x-farm-deployment-mismatch"),
        cookies: staleNavigation.headers.getSetCookie(),
      },
      pathname,
    ).toEqual({ status: 409, mismatch: "1", cookies: [] });
    await staleNavigation.body?.cancel();
  }
}

async function startDevelopment(root: string): Promise<string> {
  const server = await createServer({ root });
  devServers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

async function withProduction(root: string, check: (origin: string) => Promise<void>) {
  const config = await resolveConfig(
    { ...(await loadConfig(root, undefined, "production")), root },
    "production",
  );
  await build(config, { root, preset: "node-server" });

  const output = path.join(root, ".farm", ".output");
  const port = await getAvailablePort();
  const processOutput: string[] = [];
  const productionServer = spawn(process.execPath, [path.join(output, "server", "index.mjs")], {
    cwd: path.join(output, "server"),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  productionServer.stdout.on("data", (chunk) => processOutput.push(String(chunk)));
  productionServer.stderr.on("data", (chunk) => processOutput.push(String(chunk)));
  const exited = new Promise<void>((resolve) => productionServer.once("exit", () => resolve()));

  try {
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 200 && !ready; attempt++) {
      if (productionServer.exitCode !== null) break;
      ready = await fetch(`${origin}/_farm/health/ready`).then(
        (response) => response.ok,
        () => false,
      );
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready, processOutput.join("")).toBe(true);

    await check(origin);
  } finally {
    if (productionServer.exitCode === null) productionServer.kill();
    await exited;
  }
}

describe("deployment skew protection", () => {
  it("in development", async () => {
    const root = await createApp("farm-dev-deployment-skew-");
    const origin = await startDevelopment(root);
    await expectDeploymentSkewContract(origin);
    await expectDocsAndNotFoundPagesNameDeployment(origin, "development");
  }, 120_000);

  it("in a node-server production build", async () => {
    const root = await createApp("farm-prod-deployment-skew-");
    await withProduction(root, async (origin) => {
      await expectDeploymentSkewContract(origin);
      await expectSharedCachePagesKeepCaching(origin);
      await expectDocsAndNotFoundPagesNameDeployment(origin, "production");
    });
  }, 240_000);
});
