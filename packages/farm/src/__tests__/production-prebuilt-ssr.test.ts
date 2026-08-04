// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { loadFarmProductionVite, type FarmProductionViteRuntime } from "../build/production-vite";
import { resolveConfig } from "../config";
import { defineIntegration } from "../integrations";
import { definePlugin } from "../plugin";
import { logger } from "../utils";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createProductionFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-prebuilt-ssr-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), {
    recursive: true,
  });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "dir");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.mkdir(path.join(root, "src", "lib"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `
export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>;
}
`.trim(),
  );
  await fs.writeFile(path.join(root, "src", "app", "prebuilt-ssr-marker.txt"), "copied SSR asset");
  await fs.writeFile(
    path.join(root, "src", "lib", "alias-marker.ts"),
    `export const aliasMarker = "src alias resolved";`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `
import markerAsset from "./prebuilt-ssr-marker.txt?url";
import { aliasMarker } from "@/lib/alias-marker";

export default function Page() {
  return <main data-prebuilt-ssr="ready" data-marker-asset={markerAsset}>prebuilt SSR output: {aliasMarker}</main>;
}
`.trim(),
  );

  return root;
}

async function linkReact18(root: string): Promise<void> {
  const fixtureModules = path.resolve(packageRoot, "../../examples/simple-demo/node_modules");
  let reactPath: string;
  let reactDOMPath: string;

  try {
    [reactPath, reactDOMPath] = await Promise.all([
      fs.realpath(path.join(fixtureModules, "react")),
      fs.realpath(path.join(fixtureModules, "react-dom")),
    ]);
  } catch {
    throw new Error("React 18 compatibility fixture dependencies are missing");
  }

  await fs.symlink(reactPath, path.join(root, "node_modules", "react"), "dir");
  await fs.symlink(reactDOMPath, path.join(root, "node_modules", "react-dom"), "dir");
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
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

async function waitForServer(
  url: string,
  processOutput: () => string,
  hasExited: () => boolean,
  requestInit?: RequestInit,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (hasExited()) {
      throw new Error(`Production server exited before it was ready:\n${processOutput()}`);
    }
    try {
      return await fetch(url, requestInit);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(
    `Production server did not become ready: ${String(lastError)}\n${processOutput()}`,
  );
}

async function runProductionRequest(
  serverDir: string,
  assertion: (response: Response) => Promise<void>,
  pathname = "/",
  requestInit?: RequestInit,
): Promise<void> {
  const port = await getAvailablePort();
  const output: string[] = [];
  let spawnError: Error | undefined;
  const productionServer = spawn(process.execPath, [path.join(serverDir, "index.mjs")], {
    cwd: serverDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  productionServer.stdout.on("data", (chunk) => output.push(String(chunk)));
  productionServer.stderr.on("data", (chunk) => output.push(String(chunk)));
  productionServer.on("error", (error) => {
    spawnError = error;
  });

  try {
    const response = await waitForServer(
      `http://127.0.0.1:${port}${pathname}`,
      () => (spawnError ? `${spawnError.message}\n${output.join("")}` : output.join("")),
      () => spawnError !== undefined || productionServer.exitCode !== null,
      requestInit,
    );
    try {
      await assertion(response);
    } catch (error) {
      throw new Error(`${String(error)}\nProduction output:\n${output.join("")}`);
    }
  } finally {
    if (productionServer.exitCode === null) {
      productionServer.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          productionServer.kill("SIGKILL");
          resolve();
        }, 2_000);
        productionServer.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }
}

async function readJavaScriptOutput(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return readJavaScriptOutput(entryPath);
      return entry.name.endsWith(".mjs") ? fs.readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

async function containsFileWithContent(dir: string, expected: string): Promise<boolean> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await containsFileWithContent(entryPath, expected)) return true;
    } else if ((await fs.readFile(entryPath, "utf8")) === expected) {
      return true;
    }
  }
  return false;
}

async function expectNitroFallback(root: string): Promise<void> {
  const serverDir = path.join(root, ".farm", ".output", "server");
  const serverPackage = JSON.parse(await fs.readFile(path.join(serverDir, "package.json"), "utf8"));
  expect(serverPackage.imports?.["#farm-ssr-entry"]).toBeUndefined();
  await expect(fs.access(path.join(serverDir, "farm-ssr"))).rejects.toThrow();
  await expect(fs.readFile(path.join(serverDir, "index.mjs"), "utf8")).resolves.not.toContain(
    "#farm-ssr-entry",
  );
}

describe("production prebuilt SSR output", () => {
  it("retries an incomplete Rolldown client bundle after the parallel SSR build", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "globals.css"),
        ".client-output-marker { color: red; }",
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
"use client";

export default function Page() {
  return <main className="client-output-marker">client output retry</main>;
}
`.trim(),
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "client-output-retry-test",
        },
        "production",
      );
      const productionVite = await loadFarmProductionVite();
      let clientBuildAttempts = 0;
      const buildWithIncompleteFirstClient = (async (inlineConfig: any) => {
        if (!inlineConfig.build?.ssr) {
          clientBuildAttempts++;
          if (clientBuildAttempts === 1) {
            const outputDir = path.resolve(inlineConfig.root, inlineConfig.build.outDir);
            await fs.mkdir(outputDir, { recursive: true });
            await fs.writeFile(path.join(outputDir, "farm-client.js"), "");
            return { output: [] };
          }
        }

        return productionVite.build(inlineConfig);
      }) as FarmProductionViteRuntime["build"];
      const retryingProductionVite: FarmProductionViteRuntime = {
        ...productionVite,
        build: buildWithIncompleteFirstClient,
        builder: "rolldown",
      };

      await build(config, {
        root,
        preset: "node-server",
        productionVite: retryingProductionVite,
      });

      expect(clientBuildAttempts).toBe(2);
      await expect(
        fs.readFile(path.join(root, ".farm", "client", "farm-client.js"), "utf8"),
      ).resolves.not.toBe("");
      await expect(
        fs.readFile(path.join(root, ".farm", "client", "farm-client.css"), "utf8"),
      ).resolves.toContain(".client-output-marker");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("boots standalone Node output through the package import mapping", async () => {
    const root = await createProductionFixture();
    const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "farm-standalone-prebuilt-"));

    try {
      const staticPageDir = path.join(root, "src", "app", "static-page");
      const dynamicPageDir = path.join(root, "src", "app", "[slug]");
      const exactPageDir = path.join(root, "src", "app", "about");
      const optionalCatchAllDir = path.join(root, "src", "app", "docs", "[[...parts]]");
      await Promise.all(
        [staticPageDir, dynamicPageDir, exactPageDir, optionalCatchAllDir].map((dir) =>
          fs.mkdir(dir, { recursive: true }),
        ),
      );
      await fs.writeFile(
        path.join(staticPageDir, "page.tsx"),
        `
"use client";

import { useState } from "react";

export const ssg = true;

export default function StaticPage() {
  const [count] = useState(0);
  return <main>static production page {count}</main>;
}
`.trim(),
      );
      await Promise.all([
        fs.writeFile(
          path.join(dynamicPageDir, "page.tsx"),
          `
export default function DynamicPage({ params }) {
  return <main>dynamic production route {params.slug}</main>;
}
`.trim(),
        ),
        fs.writeFile(
          path.join(exactPageDir, "page.tsx"),
          `export default function AboutPage() { return <main>exact production route</main>; }`,
        ),
        fs.writeFile(
          path.join(optionalCatchAllDir, "page.tsx"),
          `export default function DocsPage() { return <main>optional catch-all production route</main>; }`,
        ),
      ]);
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          redirects: () => [
            {
              source: "/legacy-home",
              destination: "/",
              permanent: true,
            },
          ],
          headers: () => [
            {
              source: "/:path*",
              headers: [{ key: "X-Production-Header", value: "standalone" }],
            },
          ],
          generateBuildId: () => "prebuilt-ssr-test",
        },
        "production",
      );
      const nodeEnvBeforeBuild = process.env.NODE_ENV;
      await build(config, { root, preset: "node-server" });
      expect(process.env.NODE_ENV).toBe(nodeEnvBeforeBuild);

      const clientBundle = await fs.readFile(
        path.join(root, ".farm", "client", "farm-client.js"),
        "utf8",
      );
      expect(clientBundle).toContain("Minified React error");
      expect(clientBundle).not.toContain("Download the React DevTools");

      const isolatedOutput = path.join(isolatedRoot, "output");
      await fs.cp(path.join(root, ".farm", ".output"), isolatedOutput, {
        recursive: true,
      });
      const serverDir = path.join(isolatedOutput, "server");
      const serverPackage = JSON.parse(
        await fs.readFile(path.join(serverDir, "package.json"), "utf8"),
      );
      const mappedEntry = serverPackage.imports?.["#farm-ssr-entry"];
      expect(mappedEntry).toMatch(/^\.\/farm-ssr\//);
      await expect(
        containsFileWithContent(path.join(serverDir, "farm-ssr"), "copied SSR asset"),
      ).resolves.toBe(true);
      await expect(readJavaScriptOutput(serverDir)).resolves.toContain("mergeVaryHeaders");

      await fs.rm(path.join(root, ".farm", "ssr"), {
        recursive: true,
        force: true,
      });
      await runProductionRequest(serverDir, async (response) => {
        expect(response.status).toBe(200);
        expect(response.headers.get("x-production-header")).toBe("standalone");
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        const html = await response.text();
        expect(html).toContain("prebuilt SSR output");
        expect(html).toContain("src alias resolved");

        const staticUrl = new URL("/static-page", response.url);
        const staticResponse = await fetch(staticUrl);
        expect(staticResponse.status).toBe(200);
        expect(staticResponse.headers.get("content-type")).toContain("text/html");
        expect(staticResponse.headers.get("cache-control")).toBe(
          "public, max-age=0, must-revalidate",
        );
        expect(staticResponse.headers.get("x-production-header")).toBe("standalone");
        const staticHtml = await staticResponse.text();
        expect(staticHtml).toContain("static production page");

        const authenticatedStaticResponse = await fetch(staticUrl, {
          headers: { Authorization: "Bearer production-test" },
        });
        expect(authenticatedStaticResponse.status).toBe(200);
        expect(authenticatedStaticResponse.headers.get("cache-control")).toBe(
          "public, max-age=0, must-revalidate",
        );
        expect(authenticatedStaticResponse.headers.get("x-production-header")).toBe("standalone");
        await expect(authenticatedStaticResponse.text()).resolves.toBe(staticHtml);

        for (const pathname of ["/about", "/about/"]) {
          const exactResponse = await fetch(new URL(pathname, response.url));
          expect(exactResponse.status).toBe(200);
          await expect(exactResponse.text()).resolves.toContain("exact production route");
        }

        const dynamicResponse = await fetch(new URL("/contact", response.url));
        expect(dynamicResponse.status).toBe(200);
        const dynamicHtml = await dynamicResponse.text();
        expect(dynamicHtml).toContain("dynamic production route");
        expect(dynamicHtml).toContain("contact");

        for (const pathname of ["/docs", "/docs/routing/production"]) {
          const catchAllResponse = await fetch(new URL(pathname, response.url));
          expect(catchAllResponse.status).toBe(200);
          await expect(catchAllResponse.text()).resolves.toContain(
            "optional catch-all production route",
          );
        }
      });
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(308);
          expect(response.headers.get("location")).toBe("/");
          expect(response.headers.get("x-production-header")).toBe("standalone");
        },
        "/legacy-home",
        { redirect: "manual" },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(isolatedRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps standalone production API failures generic", async () => {
    const root = await createProductionFixture();

    try {
      const failureApiDir = path.join(root, "src", "app", "api", "failure");
      const afterApiDir = path.join(root, "src", "app", "api", "after-response");
      const afterMarkerPath = path.join(root, "after-response.txt");
      await fs.mkdir(failureApiDir, { recursive: true });
      await fs.mkdir(afterApiDir, { recursive: true });
      await fs.writeFile(
        path.join(failureApiDir, "route.ts"),
        `
export async function GET() {
  throw new Error("database-password-sentinel");
}
`.trim(),
      );
      await fs.writeFile(
        path.join(afterApiDir, "route.ts"),
        `
import { writeFile } from "node:fs/promises";
import { after } from "@farm.js/core";

export async function GET() {
  after(() => writeFile(${JSON.stringify(afterMarkerPath)}, "finished"));
  return Response.json({ accepted: true }, { status: 202 });
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "production-api-failure-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(500);
          const body = await response.text();
          expect(body).toContain("Internal Server Error");
          expect(body).not.toContain("database-password-sentinel");
        },
        "/api/failure",
      );
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(202);
          await expect(response.json()).resolves.toEqual({ accepted: true });

          let marker = "";
          for (let attempt = 0; attempt < 100 && marker !== "finished"; attempt++) {
            try {
              marker = await fs.readFile(afterMarkerPath, "utf8");
            } catch {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          }
          expect(marker).toBe("finished");
        },
        "/api/after-response",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it.each([
    { label: "React 18", useReact18: true },
    { label: "React 19", useReact18: false },
  ])(
    "streams $label Suspense and renders the nearest route error boundary",
    async ({ useReact18 }) => {
      const root = await createProductionFixture();

      try {
        if (useReact18) await linkReact18(root);
        const suspenseDir = path.join(root, "src", "app", "suspense");
        const failureDir = path.join(root, "src", "app", "failure");
        await fs.mkdir(suspenseDir, { recursive: true });
        await fs.mkdir(failureDir, { recursive: true });
        await fs.writeFile(
          path.join(root, "src", "app", "layout.tsx"),
          `
export default function RootLayout({ children }) {
  return <div data-layout="root">{children}</div>;
}
`.trim(),
        );
        await fs.writeFile(
          path.join(suspenseDir, "content.tsx"),
          `
export default function SuspenseContent() {
  return <p data-suspense="ready">suspense-ready</p>;
}
`.trim(),
        );
        await fs.writeFile(
          path.join(suspenseDir, "page.tsx"),
          `
import React, { lazy, Suspense } from "react";

const SuspenseContent = lazy(() =>
  new Promise((resolve) => {
    setTimeout(() => resolve(import("./content")), 750);
  }),
);

export default function SuspensePage() {
  const renderCount = (globalThis.__farmSuspensePageRenderCount || 0) + 1;
  globalThis.__farmSuspensePageRenderCount = renderCount;

  return (
    <main data-page-render-count={renderCount}>
      <Suspense fallback={<p>suspense-fallback</p>}>
        <SuspenseContent />
      </Suspense>
    </main>
  );
}
`.trim(),
        );
        await fs.writeFile(
          path.join(failureDir, "page.tsx"),
          `
import React, { lazy, Suspense } from "react";

export const ppr = true;

const LateFailure = lazy(() =>
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error("intentional-production-failure")), 100);
  }),
);

export default function FailurePage() {
  return (
    <Suspense fallback={<p>failure-loading</p>}>
      <LateFailure />
    </Suspense>
  );
}
`.trim(),
        );
        await fs.writeFile(
          path.join(failureDir, "error.tsx"),
          `
export default function FailureBoundary({ error, path }) {
  return (
    <section data-error-boundary="route">
      <h1>route-error-boundary</h1>
      <p>{error.message}</p>
      <p>{path}</p>
    </section>
  );
}
`.trim(),
        );
        await fs.writeFile(
          path.join(root, "src", "farm.routes.tsx"),
          `
import { createRoute, defineRoutes, notFound, redirect } from "@farm.js/core";

function ProgrammaticPending() {
  return <p data-programmatic-pending="true">programmatic-data-pending</p>;
}

function ProgrammaticPage({ data }) {
  return (
    <p data-programmatic-ready="true" data-programmatic-count={data.count}>
      programmatic-data-{data.message}
    </p>
  );
}

function ProgrammaticError({ error }) {
  return <p data-programmatic-error="true">{error.message}</p>;
}

function ProgrammaticNotFound() {
  return <p data-programmatic-not-found="true">programmatic-not-found</p>;
}

export const ProgrammaticPendingRoute = createRoute("/programmatic-pending", {
  search: {
    schema: { parse(value) { return value; } },
    temporary: ["toast"],
  },
  data: {
    async main() {
      await new Promise((resolve) => setTimeout(resolve, 750));
      const count = ((globalThis as any).__farmProgrammaticPendingCount || 0) + 1;
      (globalThis as any).__farmProgrammaticPendingCount = count;
      return { message: "ready", count };
    },
  },
  pending: ProgrammaticPending,
  component: ProgrammaticPage,
});

export const ProgrammaticErrorRoute = createRoute("/programmatic-error", {
  data: {
    async main() {
      await Promise.resolve();
      throw new Error("programmatic-load-failed");
    },
  },
  pending: ProgrammaticPending,
  error: ProgrammaticError,
  component: ProgrammaticPage,
});

export const ProgrammaticNotFoundRoute = createRoute("/programmatic-not-found", {
  data: {
    async main() {
      await Promise.resolve();
      notFound();
    },
  },
  pending: ProgrammaticPending,
  notFound: ProgrammaticNotFound,
  component: ProgrammaticPage,
});

export const ProgrammaticRedirectRoute = createRoute("/programmatic-redirect", {
  data: {
    async main() {
      await Promise.resolve();
      redirect("/programmatic-pending");
    },
  },
  pending: ProgrammaticPending,
  component: ProgrammaticPage,
});

export default defineRoutes(() => [
  ProgrammaticPendingRoute,
  ProgrammaticErrorRoute,
  ProgrammaticNotFoundRoute,
  ProgrammaticRedirectRoute,
]);
`.trim(),
        );

        const config = await resolveConfig(
          {
            root,
            srcDir: "src",
            images: { provider: "none" },
            generateBuildId: () => "production-boundaries-test",
          },
          "production",
        );
        await build(config, { root, preset: "node-server" });

        const serverDir = path.join(root, ".farm", ".output", "server");
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toBe("private, no-store");
            expect(response.body).not.toBeNull();
            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let html = "";

            while (!html.includes("suspense-fallback")) {
              const chunk = await reader.read();
              expect(chunk.done).toBe(false);
              html += decoder.decode(chunk.value, { stream: true });
            }

            expect(html).not.toContain("suspense-ready");

            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              html += decoder.decode(chunk.value, { stream: true });
            }
            html += decoder.decode();
            expect(html).toContain("suspense-ready");
            expect(html).toContain('data-page-render-count="1"');
            expect(html).not.toContain('data-page-render-count="2"');
            expect(html).toContain('<link rel="modulepreload" href="/farm-client.js">');
            expect(html).not.toContain("renderToString which does not support Suspense");
          },
          "/suspense",
        );
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(200);
            const html = await response.text();
            expect(html).toContain('data-programmatic-ready="true"');
            expect(html).toContain('data-programmatic-count="1"');
            expect(html).not.toContain("programmatic-data-pending");
            expect(html).toContain("history.replaceState");
            expect(html).not.toContain("toast=saved");
          },
          "/programmatic-pending?toast=saved",
        );
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(500);
            expect(response.headers.get("cache-control")).toBe("private, no-store");
            await expect(response.text()).resolves.toContain("programmatic-load-failed");
          },
          "/programmatic-error",
        );
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(404);
            expect(response.headers.get("cache-control")).toBe("private, no-store");
            await expect(response.text()).resolves.toContain("programmatic-not-found");
          },
          "/programmatic-not-found",
        );
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(307);
            expect(response.headers.get("location")).toBe("/programmatic-pending");
          },
          "/programmatic-redirect",
          { redirect: "manual" },
        );
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(500);
            expect(response.headers.get("cache-control")).toBe("private, no-store");
            expect(response.headers.get("x-farm-ppr")).not.toBe("hit");
            const html = await response.text();
            expect(html).toContain('id="root"');
            expect(html).toContain("route-error-boundary");
            expect(html).toContain("intentional-production-failure");
            expect(html).toContain("/failure");
          },
          "/failure",
        );
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(500);
            expect(response.headers.get("x-farm-ppr")).not.toBe("hit");
            await expect(response.text()).resolves.toContain("route-error-boundary");
          },
          "/failure",
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("boots an isolated Node output when runtime routes import the package root", async () => {
    const root = await createProductionFixture();
    const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "farm-standalone-root-api-"));

    try {
      const apiDir = path.join(root, "src", "app", "api", "runtime");
      await fs.mkdir(apiDir, { recursive: true });
      await fs.writeFile(
        path.join(apiDir, "route.ts"),
        `
import { createEndpoint } from "@farm.js/core";

export const GET = createEndpoint(
  "/api/runtime",
  { method: "GET" },
  () => ({ ok: true, source: "package-root" }),
);
`.trim(),
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          cron: {
            runtimeProbe: {
              schedule: "0 2 * * *",
              path: "/api/runtime",
            },
          },
          generateBuildId: () => "isolated-root-api-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const isolatedOutput = path.join(isolatedRoot, "output");
      await fs.cp(path.join(root, ".farm", ".output"), isolatedOutput, {
        recursive: true,
      });
      await fs.rm(root, { recursive: true, force: true });

      await runProductionRequest(
        path.join(isolatedOutput, "server"),
        async (response) => {
          expect(response.status).toBe(200);
          await expect(response.json()).resolves.toEqual({
            ok: true,
            source: "package-root",
          });
        },
        "/api/runtime",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(isolatedRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("supports an explicitly configured Rolldown adapter build", async () => {
    const root = await createProductionFixture();

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "explicit-rolldown-test",
          plugins: [
            definePlugin({
              name: "explicit-rolldown-test",
              build: {
                configure(nitroConfig) {
                  return { ...nitroConfig, builder: "rolldown" };
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const serverPackage = JSON.parse(
        await fs.readFile(path.join(root, ".farm", ".output", "server", "package.json"), "utf8"),
      );
      expect(serverPackage.imports?.["#farm-ssr-entry"]).toMatch(/^\.\/farm-ssr\//);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps plugin-replaced requests current during production rendering", async () => {
    const root = await createProductionFixture();
    const runtimePlugin = `
{
  name: "production-runtime-request-context",
  runtime: {
    before({ request }) {
      const headers = new Headers(request.headers);
      headers.set("x-plugin-request", "transformed");
      return new Request(request, { headers });
    },
  },
}`;

    try {
      await fs.writeFile(
        path.join(root, "farm.config.mjs"),
        `export default { plugins: [${runtimePlugin}] };`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import { getCurrentRequest } from "@farm.js/core/request";

export default function Page() {
  return <main data-plugin-request={getCurrentRequest().headers.get("x-plugin-request")}>plugin request context</main>;
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "production-runtime-request-context-test",
          plugins: [
            definePlugin({
              name: "production-runtime-request-context",
              runtime: {
                before({ request }) {
                  const headers = new Headers(request.headers);
                  headers.set("x-plugin-request", "transformed");
                  return new Request(request, { headers });
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html.match(/<main[^>]*>/)?.[0]).toContain('data-plugin-request="transformed"');
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("honors NITRO_BUILDER=rollup", async () => {
    const root = await createProductionFixture();
    const previousBuilder = process.env.NITRO_BUILDER;
    const info = vi.spyOn(logger, "info");
    process.env.NITRO_BUILDER = "rollup";

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "nitro-builder-rollup-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const serverPackage = JSON.parse(
        await fs.readFile(path.join(root, ".farm", ".output", "server", "package.json"), "utf8"),
      );
      expect(serverPackage.imports?.["#farm-ssr-entry"]).toMatch(/^\.\/farm-ssr\//);
      expect(info).not.toHaveBeenCalledWith("⚡ Built the Node adapter with Rolldown");
    } finally {
      if (previousBuilder === undefined) delete process.env.NITRO_BUILDER;
      else process.env.NITRO_BUILDER = previousBuilder;
      info.mockRestore();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("preserves an explicit minify false build hook", async () => {
    const root = await createProductionFixture();
    let configureCalls = 0;

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "prebuilt-ssr-test",
          plugins: [
            definePlugin({
              name: "unminified-prebuilt-ssr-test",
              build: {
                configure(nitroConfig) {
                  configureCalls++;
                  return { ...nitroConfig, minify: false };
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const serverDir = path.join(root, ".farm", ".output", "server");
      const serverPackage = JSON.parse(
        await fs.readFile(path.join(serverDir, "package.json"), "utf8"),
      );
      const mappedEntry = serverPackage.imports?.["#farm-ssr-entry"];
      expect(configureCalls).toBe(1);
      expect(mappedEntry).toMatch(/^\.\/farm-ssr\//);
      const copiedEntry = path.join(serverDir, mappedEntry);
      const sourceEntry = path.join(root, ".farm", "ssr", mappedEntry.slice("./farm-ssr/".length));
      await expect(fs.readFile(copiedEntry, "utf8")).resolves.toBe(
        await fs.readFile(sourceEntry, "utf8"),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("packages the Sharp runtime for standalone Node image optimization", async () => {
    const root = await createProductionFixture();
    const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "farm-standalone-sharp-"));
    const { default: sharp } = await import("sharp");
    const png = await sharp({
      create: {
        width: 2,
        height: 1,
        channels: 4,
        background: { r: 20, g: 100, b: 220, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    try {
      await fs.mkdir(path.join(root, "public"), { recursive: true });
      await fs.writeFile(path.join(root, "public", "product.png"), png);
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "node", formats: ["image/webp"] },
          generateBuildId: () => "prebuilt-ssr-sharp-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const isolatedOutput = path.join(isolatedRoot, "output");
      await fs.cp(path.join(root, ".farm", ".output"), isolatedOutput, {
        recursive: true,
      });
      await fs.rm(root, { recursive: true, force: true });

      const serverDir = path.join(isolatedOutput, "server");
      const serverPackage = JSON.parse(
        await fs.readFile(path.join(serverDir, "package.json"), "utf8"),
      );
      expect(serverPackage.dependencies?.sharp).toBeTruthy();
      await expect(
        fs.access(path.join(serverDir, "node_modules", "sharp", "package.json")),
      ).resolves.toBeUndefined();

      const query = new URLSearchParams({
        url: "/product.png",
        w: "16",
        q: "75",
      });
      await runProductionRequest(
        serverDir,
        async (response) => {
          if (!response.ok) {
            throw new Error(
              `Image optimizer returned ${response.status}: ${await response.text()}`,
            );
          }
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("image/webp");
          expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
        },
        `/_farm/image?${query}`,
        { headers: { accept: "image/webp" } },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(isolatedRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("retains Nitro's bundle path when a build plugin customizes Rollup", async () => {
    const root = await createProductionFixture();
    let configureCalls = 0;
    let rollupBuildStarts = 0;

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "prebuilt-ssr-test",
          plugins: [
            definePlugin({
              name: "custom-rollup-fallback-test",
              build: {
                configure(nitroConfig) {
                  configureCalls++;
                  return {
                    ...nitroConfig,
                    rollupConfig: {
                      ...nitroConfig.rollupConfig,
                      plugins: [
                        {
                          name: "custom-rollup-fallback-test",
                          buildStart() {
                            rollupBuildStarts++;
                          },
                        },
                      ],
                    },
                  };
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      expect(configureCalls).toBe(1);
      expect(rollupBuildStarts).toBeGreaterThan(0);
      await expectNitroFallback(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("retains Nitro's bundle path when a build plugin replaces externalization", async () => {
    const root = await createProductionFixture();
    let externalCalls = 0;

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "prebuilt-ssr-test",
          plugins: [
            definePlugin({
              name: "custom-external-fallback-test",
              build: {
                configure(nitroConfig) {
                  const defaultExternal = nitroConfig.rollupConfig.external;
                  if (typeof defaultExternal !== "function") {
                    throw new TypeError("Expected Nitro's default external predicate");
                  }
                  return {
                    ...nitroConfig,
                    rollupConfig: {
                      ...nitroConfig.rollupConfig,
                      external(id: string, importer: string | undefined, isResolved: boolean) {
                        externalCalls++;
                        return defaultExternal(id, importer, isResolved);
                      },
                    },
                  };
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      expect(externalCalls).toBeGreaterThan(0);
      await expectNitroFallback(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("retains Nitro's bundle path when a build plugin configures replacements", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
export default function Page() {
  return <main data-prebuilt-ssr="ready">{process.env.FARM_NITRO_REPLACE_TEST}</main>;
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "prebuilt-ssr-test",
          plugins: [
            definePlugin({
              name: "custom-replace-fallback-test",
              build: {
                configure(nitroConfig) {
                  return {
                    ...nitroConfig,
                    replace: {
                      ...nitroConfig.replace,
                      "process.env.FARM_NITRO_REPLACE_TEST": JSON.stringify("nitro-replaced"),
                    },
                  };
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      await expectNitroFallback(root);
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          await expect(response.text()).resolves.toContain("nitro-replaced");
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("retains Nitro's bundle path when a late Nitro build hook is configured", async () => {
    const root = await createProductionFixture();
    let rollupHookCalls = 0;

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "prebuilt-ssr-test",
          plugins: [
            definePlugin({
              name: "late-nitro-hook-fallback-test",
              build: {
                configure(nitroConfig) {
                  return {
                    ...nitroConfig,
                    hooks: {
                      ...nitroConfig.hooks,
                      "rollup:before"(_nitro: unknown, rollupConfig: { plugins: unknown[] }) {
                        rollupHookCalls++;
                        rollupConfig.plugins.push({
                          name: "late-rollup-hook-test",
                        });
                      },
                    },
                  };
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      expect(rollupHookCalls).toBe(1);
      await expectNitroFallback(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps platform-owned integration config out of Cloudflare runtime output", async () => {
    const root = await createProductionFixture();
    const runtimeMarker = "platform-owned-config-must-not-enter-worker";

    try {
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  runtimeMarker: ${JSON.stringify(runtimeMarker)},
});
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "platform-owned-cloudflare-test",
          integrations: {
            agent: defineIntegration({
              category: "agent",
              type: "platform-owned",
              instance: {},
              serverRuntime: false,
            }),
          },
          deploy: {
            target: "cloudflare",
            preset: "cloudflare-module",
          },
        },
        "production",
      );
      await build(config, { root, preset: "cloudflare-module" });

      const serverOutput = await readJavaScriptOutput(
        path.join(root, config.deploy.outputDir, "server"),
      );
      expect(serverOutput).not.toContain(runtimeMarker);
      expect(serverOutput).not.toContain("buildNitroUniversal");
      expect(serverOutput).not.toContain('from"lightningcss"');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("bundles generated metadata images for the Cloudflare worker runtime", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "opengraph-image.tsx"),
        `
export const alt = "Cloudflare metadata image";

function Label({ children }) {
  return <span className="text-4xl text-white">{children}</span>;
}

export default function OpenGraphImage() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#09090b]">
      <Label>Farm.js on Cloudflare</Label>
    </div>
  );
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "metadata-image-cloudflare-test",
          deploy: {
            target: "cloudflare",
            preset: "cloudflare-module",
          },
        },
        "production",
      );

      await build(config, { root, preset: "cloudflare-module" });

      const serverOutput = await readJavaScriptOutput(
        path.join(root, config.deploy.outputDir, "server"),
      );
      expect(serverOutput).not.toContain(".wasm?module");
      expect(serverOutput).toContain("Cloudflare metadata image");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
