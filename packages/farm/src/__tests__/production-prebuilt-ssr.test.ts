// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { loadFarmProductionVite, type FarmProductionViteRuntime } from "../build/production-vite";
import { resolveConfig } from "../config";
import { defineIntegration } from "../integrations";
import { definePlugin } from "../plugin";
import { logger } from "../utils";

const isWindows = process.platform === "win32";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createProductionFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-prebuilt-ssr-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), {
    recursive: true,
  });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
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

function isolatedParityCounterSource(version: string): string {
  return `
"use client";

import { useState } from "react";

export default function LiveCounter({ name }) {
  const [count, setCount] = useState(0);
  return (
    <button data-live-counter={name} onClick={() => setCount((value) => value + 1)}>
      ${version}:{name}:{count}
    </button>
  );
}
`.trim();
}

async function createIsolatedParityFixture(options: { ssg?: boolean } = {}): Promise<string> {
  const root = await createProductionFixture();
  await fs.writeFile(
    path.join(root, "src", "lib", "server-sentinel.ts"),
    `export const serverSentinel = "SERVER_LAYOUT_SENTINEL_ISOLATED_PARITY";`,
  );
  await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "components", "live-counter.tsx"),
    isolatedParityCounterSource("before"),
  );
  await fs.writeFile(
    path.join(root, "src", "components", "stable-counter.tsx"),
    `
"use client";

import { useState } from "react";

export default function StableCounter() {
  const [count, setCount] = useState(0);
  return <button data-stable-counter onClick={() => setCount((value) => value + 1)}>stable:{count}</button>;
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "components", "fallback-counter.tsx"),
    `
"use client";

import { useState } from "react";

function FallbackCounter() {
  const [count, setCount] = useState(0);
  return <button data-fallback-counter onClick={() => setCount((value) => value + 1)}>fallback:{count}</button>;
}

export { FallbackCounter };
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `
import LiveCounter from "../components/live-counter";
import StableCounter from "../components/stable-counter";
import { serverSentinel } from "../lib/server-sentinel";

export default function RootLayout({ children }) {
  return (
    <section data-parity-layout data-server-sentinel={serverSentinel}>
      <LiveCounter name="first" />
      <LiveCounter name="second" />
      <StableCounter />
      {children}
    </section>
  );
}
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `${options.ssg ? "export const ssg = true;\n\n" : ""}export default function Page() { return <main data-parity-page>Parity page <a href="/fallback" data-nav-fallback>Fallback</a></main>; }`,
  );
  await fs.mkdir(path.join(root, "src", "app", "fallback"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "app", "fallback", "page.tsx"),
    `
import { FallbackCounter } from "../../components/fallback-counter";

${options.ssg ? "export const ssg = true;" : ""}

export default function FallbackPage() {
  return <main data-fallback-page><FallbackCounter /><a href="/" data-nav-home>Home</a></main>;
}
`.trim(),
  );
  return root;
}

type IsolatedBoundaryMetadata = {
  reference: string;
  exportName: string;
  strategy: string;
};

function readIsolatedBoundaryMetadata(html: string): IsolatedBoundaryMetadata[] {
  const readAttribute = (attributes: string, name: string) =>
    attributes.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
  return Array.from(html.matchAll(/<farm-client-boundary\b([^>]*)>/g), ([, attributes]) => ({
    reference: readAttribute(attributes, "data-farm-client-boundary"),
    exportName: readAttribute(attributes, "data-farm-client-export"),
    strategy: readAttribute(attributes, "data-farm-island-strategy"),
  }));
}

const isolatedParityMetadata: IsolatedBoundaryMetadata[] = [
  {
    reference: "/src/components/live-counter.tsx",
    exportName: "default",
    strategy: "load",
  },
  {
    reference: "/src/components/live-counter.tsx",
    exportName: "default",
    strategy: "load",
  },
  {
    reference: "/src/components/stable-counter.tsx",
    exportName: "default",
    strategy: "load",
  },
];

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

  await fs.symlink(reactPath, path.join(root, "node_modules", "react"), "junction");
  await fs.symlink(reactDOMPath, path.join(root, "node_modules", "react-dom"), "junction");
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

async function readClientBundle(root: string): Promise<string> {
  const clientDir = path.join(root, ".farm", "client");
  const entries = await fs.readdir(clientDir);
  const fingerprinted = entries.find((name) => /^farm-client-h[0-9a-f]+\.js$/.test(name));
  return fs.readFile(path.join(clientDir, fingerprinted ?? "farm-client.js"), "utf8");
}

async function readAllClientJavaScript(root: string): Promise<string> {
  const readDirectory = async (clientDir: string): Promise<string> => {
    const entries = await fs.readdir(clientDir, { withFileTypes: true });
    const contents = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(clientDir, entry.name);
        if (entry.isDirectory()) return readDirectory(entryPath);
        return entry.name.endsWith(".js") ? fs.readFile(entryPath, "utf8") : "";
      }),
    );
    return contents.join("\n");
  };
  return readDirectory(path.join(root, ".farm", "client"));
}

async function resolveInstalledChromiumExecutable(): Promise<string | null> {
  const configured = process.env.FARM_TEST_CHROMIUM_EXECUTABLE_PATH;
  if (configured) return configured;

  const executablePath = chromium.executablePath();
  try {
    await fs.access(executablePath);
    return executablePath;
  } catch {
    return null;
  }
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
  it("bundles automatic production-site discovery on the server only", async () => {
    const root = await createProductionFixture();

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "production-site-telemetry-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      const serverDir = path.join(root, ".farm", ".output", "server");
      const serverPackage = JSON.parse(
        await fs.readFile(path.join(serverDir, "package.json"), "utf8"),
      );
      const mappedEntry = serverPackage.imports?.["#farm-ssr-entry"];
      expect(mappedEntry).toMatch(/^\.\/farm-ssr\//);
      const serverJavaScript = await fs.readFile(
        path.join(serverDir, mappedEntry.slice("./".length)),
        "utf8",
      );
      const clientJavaScript = await readAllClientJavaScript(root);
      expect(serverJavaScript).toContain("production_site_active");
      expect(clientJavaScript).not.toContain("production_site_active");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("omits production-site discovery when product telemetry is disabled", async () => {
    const root = await createProductionFixture();

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-site-telemetry-disabled-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      const serverDir = path.join(root, ".farm", ".output", "server");
      const serverPackage = JSON.parse(
        await fs.readFile(path.join(serverDir, "package.json"), "utf8"),
      );
      const mappedEntry = serverPackage.imports?.["#farm-ssr-entry"];
      expect(mappedEntry).toMatch(/^\.\/farm-ssr\//);
      const serverJavaScript = await fs.readFile(
        path.join(serverDir, mappedEntry.slice("./".length)),
        "utf8",
      );
      expect(serverJavaScript).not.toContain("production_site_active");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it.each([
    { label: "from programmatic config", runtimeProviders: null },
    { label: "when runtime config omits providers", runtimeProviders: "" },
    {
      label: "when runtime config sets providers to undefined",
      runtimeProviders: "providers: undefined,",
    },
  ])(
    "renders custom integration providers in production $label",
    async ({ runtimeProviders }) => {
      const root = await createProductionFixture();

      try {
        await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
        await fs.writeFile(
          path.join(root, "src", "components", "acme-provider.tsx"),
          `
"use client";

export function AcmeProvider({ children, label }) {
  return <section data-acme-provider={label}>{children}</section>;
}
`.trim(),
        );
        if (runtimeProviders !== null) {
          await fs.writeFile(
            path.join(root, "farm.config.ts"),
            `
import { defineConfig, defineIntegration } from "@farm.js/core";

const acme = defineIntegration({
  category: "custom",
  type: "acme",
  instance: {},
  ${runtimeProviders}
});

export default defineConfig({ integrations: { acme } });
`.trim(),
          );
        }
        const acme = defineIntegration({
          category: "custom",
          type: "acme",
          instance: {},
          providers: [
            {
              name: "acme",
              type: "client",
              props: { label: "production-provider" },
              component: { module: "@/components/acme-provider", export: "AcmeProvider" },
            },
          ],
        });
        const config = await resolveConfig(
          {
            root,
            srcDir: "src",
            images: { provider: "none" },
            telemetry: false,
            integrations: { acme },
            generateBuildId: () => "programmatic-integration-provider-test",
          },
          "production",
        );

        await build(config, { root, preset: "node-server" });

        const clientJavaScript = await readAllClientJavaScript(root);
        expect(clientJavaScript).toContain("data-acme-provider");
        await runProductionRequest(
          path.join(root, ".farm", ".output", "server"),
          async (response) => {
            expect(response.status).toBe(200);
            await expect(response.text()).resolves.toContain(
              'data-acme-provider="production-provider"',
            );
          },
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("rejects opaque integration provider components in production", async () => {
    const root = await createProductionFixture();

    try {
      const acme = defineIntegration({
        category: "custom",
        type: "acme",
        instance: {},
        providers: [
          {
            name: "acme",
            type: "client",
            component: ({ children }) => children,
          },
        ],
      });
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          integrations: { acme },
          generateBuildId: () => "opaque-integration-provider-test",
        },
        "production",
      );

      await expect(build(config, { root, preset: "node-server" })).rejects.toThrow(
        "Integration provider components in production must use an importable component reference",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("isolates client leaves and preserves shared roots across navigation", async () => {
    const root = await createProductionFixture();
    const baselineRoot = await createProductionFixture();

    try {
      let randomState = 0x5f3759df;
      const serverLayoutSentinel = `SERVER_LAYOUT_SENTINEL_${Array.from({ length: 8192 }, () => {
        randomState = (randomState * 1664525 + 1013904223) >>> 0;
        return String.fromCharCode(33 + (randomState % 90));
      }).join("")}`;
      const counterSource = `
"use client";

import { useEffect, useRef, useState } from "react";

export default function Counter({ name, initial = 0 }) {
  const [count, setCount] = useState(initial);
  const ref = useRef(null);
  useEffect(() => {
    const container = ref.current?.closest("farm-client-boundary");
    globalThis.__farmIsolatedLifecycle = globalThis.__farmIsolatedLifecycle || [];
    globalThis.__farmIsolatedLifecycle.push({ type: "mount", name });
    return () => globalThis.__farmIsolatedLifecycle.push({
      type: "unmount",
      name,
      connected: container?.isConnected === true,
    });
  }, [name]);
  return <button ref={ref} data-isolated-counter={name} onClick={() => setCount(count + 1)}>{count}</button>;
}
`.trim();
      const pageCounterSource = `
"use client";

import { useEffect, useRef, useState } from "react";

export default function PageCounter({ name }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const container = ref.current?.closest("farm-client-boundary");
    globalThis.__farmIsolatedLifecycle = globalThis.__farmIsolatedLifecycle || [];
    globalThis.__farmIsolatedLifecycle.push({ type: "mount", name });
    return () => globalThis.__farmIsolatedLifecycle.push({
      type: "unmount",
      name,
      connected: container?.isConnected === true,
    });
  }, [name]);
  return <button ref={ref} data-page-counter={name} onClick={() => setCount(count + 1)}>{count}</button>;
}
`.trim();
      const childSource = `
"use client";

import { useState } from "react";

export default function ChildCounter() {
  const [count, setCount] = useState(10);
  return <button data-nested-counter onClick={() => setCount(count + 1)}>{count}</button>;
}
`.trim();
      const parentSource = `
"use client";

import ChildCounter from "./child-counter";

export default function ParentCounter() {
  return <section data-parent-counter><ChildCounter /></section>;
}
`.trim();
      const layoutSource = `
import Counter from "../components/counter";
import ParentCounter from "../components/parent-counter";

const serverLayoutSentinel = ${JSON.stringify(serverLayoutSentinel)};

export default function RootLayout({ children }) {
  return <html data-server-layout={serverLayoutSentinel}><body><nav><a data-nav-first href="/">First</a><a data-nav-second href="/second">Second</a></nav><Counter name="first" initial={2} /><Counter name="second" initial={5} /><ParentCounter />{children}</body></html>;
}
`.trim();
      const firstPageSource = `
import PageCounter from "../components/page-counter";

export default function Page() {
  return <main><h1>First page</h1><PageCounter name="first-page" /></main>;
}
`.trim();
      const secondPageSource = `
import PageCounter from "../../components/page-counter";

export default function SecondPage() {
  return <main><h1>Second page</h1><PageCounter name="second-page" /></main>;
}
`.trim();
      for (const fixtureRoot of [root, baselineRoot]) {
        await fs.mkdir(path.join(fixtureRoot, "src", "components"), { recursive: true });
        await fs.mkdir(path.join(fixtureRoot, "src", "app", "second"), { recursive: true });
        await fs.writeFile(
          path.join(fixtureRoot, "src", "components", "counter.tsx"),
          counterSource,
        );
        await fs.writeFile(
          path.join(fixtureRoot, "src", "components", "child-counter.tsx"),
          childSource,
        );
        await fs.writeFile(
          path.join(fixtureRoot, "src", "components", "parent-counter.tsx"),
          parentSource,
        );
        await fs.writeFile(
          path.join(fixtureRoot, "src", "components", "page-counter.tsx"),
          pageCounterSource,
        );
        await fs.writeFile(path.join(fixtureRoot, "src", "app", "layout.tsx"), layoutSource);
        await fs.writeFile(path.join(fixtureRoot, "src", "app", "page.tsx"), firstPageSource);
        await fs.writeFile(
          path.join(fixtureRoot, "src", "app", "second", "page.tsx"),
          secondPageSource,
        );
      }

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          experimental: { isolatedClientHydration: "enabled" },
          generateBuildId: () => "isolated-client-leaf-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const clientJavaScript = await readAllClientJavaScript(root);
      expect(clientJavaScript).not.toContain("SERVER_LAYOUT_SENTINEL_");
      expect(clientJavaScript).toContain("data-isolated-counter");
      expect(clientJavaScript).toContain("__farm_client_boundary_originals__");

      const baselineConfig = await resolveConfig(
        {
          root: baselineRoot,
          srcDir: "src",
          images: { provider: "none" },
          experimental: { isolatedClientHydration: "off" },
          generateBuildId: () => "route-wide-client-baseline-test",
        },
        "production",
      );
      await build(baselineConfig, { root: baselineRoot, preset: "node-server" });
      const baselineJavaScript = await readAllClientJavaScript(baselineRoot);
      expect(baselineJavaScript).toContain("SERVER_LAYOUT_SENTINEL_");
      expect(baselineJavaScript).not.toContain("data-farm-client-boundary");
      expect(baselineJavaScript).not.toContain("__farm_client_boundary_originals__");
      expect(baselineJavaScript).not.toContain("Could not hydrate isolated client boundary");
      expect(Buffer.byteLength(clientJavaScript)).toBeLessThan(
        Buffer.byteLength(baselineJavaScript),
      );
      expect(gzipSync(clientJavaScript).byteLength).toBeLessThan(
        gzipSync(baselineJavaScript).byteLength,
      );

      const analyzeConfig = await resolveConfig(
        {
          root: baselineRoot,
          srcDir: "src",
          images: { provider: "none" },
          experimental: { isolatedClientHydration: "analyze" },
          generateBuildId: () => "route-wide-client-baseline-test",
        },
        "production",
      );
      await build(analyzeConfig, { root: baselineRoot, preset: "node-server" });
      expect(await readAllClientJavaScript(baselineRoot)).toBe(baselineJavaScript);

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("SERVER_LAYOUT_SENTINEL_");
          expect(html).toContain('data-farm-client-boundary="/src/components/counter.tsx"');
          expect(html).toContain('data-farm-client-export="default"');
          expect(html).toContain('data-isolated-counter="first"');
          expect(html).toContain('data-isolated-counter="second"');
          expect(html).toContain("data-nested-counter");
          expect(html).toContain(">2</button>");
          expect(html).toContain('data-page-counter="first-page"');
          expect(html.match(/<farm-client-boundary/g)).toHaveLength(4);
          expect(html).not.toContain(
            'data-farm-client-boundary="/src/components/child-counter.tsx"',
          );

          const executablePath = await resolveInstalledChromiumExecutable();
          if (!executablePath) return;
          const browser = await chromium.launch({
            headless: true,
            executablePath,
          });
          try {
            const page = await browser.newPage();
            const browserErrors: string[] = [];
            page.on("console", (message) => {
              if (message.type() === "error") browserErrors.push(message.text());
            });
            page.on("pageerror", (error) => browserErrors.push(error.message));
            await page.goto(response.url);
            await page.locator('farm-client-boundary[data-farm-hydrated="true"]').nth(3).waitFor();
            const first = page.locator('[data-isolated-counter="first"]');
            const second = page.locator('[data-isolated-counter="second"]');
            await first.evaluate((element) => element.setAttribute("data-identity", "retained"));
            await first.click();
            await page.locator("[data-nested-counter]").click();
            await page.locator('[data-page-counter="first-page"]').click();

            await expect.poll(() => first.textContent()).toBe("3");
            await expect.poll(() => second.textContent()).toBe("5");
            await expect.poll(() => page.locator("[data-nested-counter]").textContent()).toBe("11");
            await expect.poll(() => first.getAttribute("data-identity")).toBe("retained");
            await expect
              .poll(() => page.locator('[data-page-counter="first-page"]').textContent())
              .toBe("1");
            await expect
              .poll(() => page.locator('farm-client-boundary[data-farm-hydrated="true"]').count())
              .toBe(4);

            await page.locator("[data-nav-second]").click();
            await expect.poll(() => page.locator("h1").textContent()).toBe("Second page");
            await page.locator('[data-page-counter="second-page"]').click();
            await expect.poll(() => first.textContent()).toBe("3");
            await expect.poll(() => first.getAttribute("data-identity")).toBe("retained");
            await expect
              .poll(() => page.locator('[data-page-counter="second-page"]').textContent())
              .toBe("1");

            await page.goBack();
            await expect.poll(() => page.locator("h1").textContent()).toBe("First page");
            await page.goForward();
            await expect.poll(() => page.locator("h1").textContent()).toBe("Second page");
            await page.evaluate(() =>
              (
                window as typeof window & {
                  __FARM_SPA_ROUTER__: {
                    navigate(href: string, options: { replace: boolean }): Promise<void>;
                  };
                }
              ).__FARM_SPA_ROUTER__.navigate("/", { replace: true }),
            );
            await expect.poll(() => page.locator("h1").textContent()).toBe("First page");

            let releaseInterruptedRequest: (() => void) | undefined;
            const interruptedRequest = new Promise<void>((resolve) => {
              releaseInterruptedRequest = resolve;
            });
            await page.route("**/second?interrupt=1", async (route) => {
              await interruptedRequest;
              await route.continue().catch(() => undefined);
            });
            const requestStarted = page.waitForRequest((request) =>
              request.url().endsWith("/second?interrupt=1"),
            );
            await page.evaluate(() => {
              void (
                window as typeof window & {
                  __FARM_SPA_ROUTER__: { navigate(href: string): Promise<void> };
                }
              ).__FARM_SPA_ROUTER__.navigate("/second?interrupt=1");
            });
            const request = await requestStarted;
            const requestSettled = Promise.race([
              page.waitForEvent("requestfinished", {
                predicate: (candidate) => candidate === request,
              }),
              page.waitForEvent("requestfailed", {
                predicate: (candidate) => candidate === request,
              }),
            ]);
            await page.evaluate(() =>
              (
                window as typeof window & {
                  __FARM_SPA_ROUTER__: {
                    navigate(href: string, options: { replace: boolean }): Promise<void>;
                  };
                }
              ).__FARM_SPA_ROUTER__.navigate("/", { replace: true }),
            );
            releaseInterruptedRequest?.();
            await requestSettled;

            await expect.poll(() => page.url()).toMatch(/\/$/);
            await expect.poll(() => page.locator("h1").textContent()).toBe("First page");
            await expect.poll(() => first.textContent()).toBe("3");
            await expect.poll(() => first.getAttribute("data-identity")).toBe("retained");
            await expect
              .poll(() => page.locator('farm-client-boundary[data-farm-hydrated="true"]').count())
              .toBe(4);

            const lifecycle = await page.evaluate(
              () =>
                (
                  globalThis as typeof globalThis & {
                    __farmIsolatedLifecycle?: Array<{
                      type: string;
                      name: string;
                      connected?: boolean;
                    }>;
                  }
                ).__farmIsolatedLifecycle ?? [],
            );
            const mounts = lifecycle.filter((event) => event.type === "mount");
            const unmounts = lifecycle.filter((event) => event.type === "unmount");
            expect(mounts.filter((event) => event.name === "first")).toHaveLength(1);
            expect(mounts.filter((event) => event.name === "second")).toHaveLength(1);
            expect(unmounts.filter((event) => event.name === "first")).toHaveLength(0);
            expect(unmounts.filter((event) => event.name === "second")).toHaveLength(0);
            expect(mounts.filter((event) => event.name === "first-page")).toHaveLength(3);
            expect(mounts.filter((event) => event.name === "second-page")).toHaveLength(2);
            expect(unmounts).toHaveLength(4);
            expect(unmounts.every((event) => event.connected === true)).toBe(true);
            expect(
              browserErrors,
              `${browserErrors.join("\n")}\nDOM:\n${await page.locator("body").innerHTML()}`,
            ).toEqual([]);
          } finally {
            await browser.close();
          }
        },
      );
    } finally {
      await Promise.all(
        [root, baselineRoot].map((fixtureRoot) =>
          fs.rm(fixtureRoot, { recursive: true, force: true }),
        ),
      );
    }
  }, 120_000);

  it("keeps the measured isolated-root overflow route-wide in development and production", async () => {
    const root = await createProductionFixture();

    try {
      await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "components", "counter.tsx"),
        `
"use client";

import { useState } from "react";

export default function Counter({ name }) {
  const [count, setCount] = useState(0);
  return <button data-cost-counter={name} onClick={() => setCount((value) => value + 1)}>{name}:{count}</button>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import Counter from "../components/counter";

export default function Page() {
  return <main>${Array.from(
    { length: 5 },
    (_, index) => `<Counter name="counter-${index + 1}" />`,
  ).join("")}</main>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "index.mjs"),
        `
import { createServer } from "@farm.js/core/server";

const server = await createServer({
  root: process.cwd(),
  images: { provider: "none" },
  telemetry: false,
  experimental: { isolatedClientHydration: "enabled" },
});
server.config.server.host = "127.0.0.1";
await server.listen(Number(process.env.PORT));
`.trim(),
      );

      const verifyRouteWideRuntime = async (response: Response) => {
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).not.toContain("<farm-client-boundary");
        expect(html).toMatch(/id="__farm_page__"[^>]*data-farm-client="true"/);

        const executablePath = await resolveInstalledChromiumExecutable();
        if (!executablePath) return;
        const browser = await chromium.launch({ headless: true, executablePath });
        try {
          const page = await browser.newPage();
          const browserErrors: string[] = [];
          page.on("console", (message) => {
            if (message.type() === "error") browserErrors.push(message.text());
          });
          page.on("pageerror", (error) => browserErrors.push(error.message));
          await page.goto(response.url);
          const counter = page.locator('[data-cost-counter="counter-3"]');
          try {
            await expect
              .poll(() =>
                counter.evaluate((element) =>
                  Object.keys(element).some((key) => key.startsWith("__reactProps$")),
                ),
              )
              .toBe(true);
            await counter.click();
            await expect.poll(() => counter.textContent()).toBe("counter-3:1");
            await expect.poll(() => page.locator("[data-cost-counter]").count()).toBe(5);
            expect(browserErrors).toEqual([]);
          } catch (error) {
            throw new Error(
              `${String(error)}\nBrowser errors:\n${browserErrors.join("\n")}\nDOM:\n${await page.locator("body").innerHTML()}`,
            );
          }
        } finally {
          await browser.close();
        }
      };

      await runProductionRequest(root, verifyRouteWideRuntime);

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          experimental: { isolatedClientHydration: "enabled" },
          generateBuildId: () => "isolated-cost-guard-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const clientJavaScript = await readAllClientJavaScript(root);
      expect(clientJavaScript).toContain("data-cost-counter");
      expect(clientJavaScript).not.toContain("__farm_client_boundary_originals__");
      expect(clientJavaScript).not.toContain("Could not hydrate isolated client boundary");

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        verifyRouteWideRuntime,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps isolated scheduling and interaction replay boundary-local in development and production", async () => {
    const root = await createProductionFixture();
    const developmentRoot = await createProductionFixture();

    try {
      const componentSource = (strategy: "load" | "interaction" | "visible" | "idle") =>
        `
"use client";

import { useEffect, useState } from "react";

export const island = "${strategy}";

export default function StrategyCounter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const lifecycle = ((globalThis as any).__farmStrategyLifecycle ||= { mounts: [], unmounts: [] });
    lifecycle.mounts.push("${strategy}");
    return () => lifecycle.unmounts.push("${strategy}");
  }, []);
  return (
    <button data-strategy="${strategy}" onClick={() => setCount((value) => value + 1)}>
      ${strategy}:{count}
    </button>
  );
}
`.trim();
      for (const strategy of ["load", "interaction", "visible", "idle"] as const) {
        const file = path.join(root, "src", "components", `${strategy}.tsx`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, componentSource(strategy));
      }
      await fs.mkdir(path.join(root, "src", "app", "second"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import Load from "../components/load";
import Interaction from "../components/interaction";
import Visible from "../components/visible";
import Idle from "../components/idle";

export default function Page() {
  return (
    <main>
      <h1>Scheduling</h1>
      <a href="/second" data-nav-second>Second page</a>
      <Load />
      <Interaction />
      <div style={{ marginTop: 5000 }}><Visible /></div>
      <Idle />
    </main>
  );
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "second", "page.tsx"),
        `export default function SecondPage() { return <main><h1>Second page</h1></main>; }`,
      );
      await fs.cp(path.join(root, "src"), path.join(developmentRoot, "src"), {
        recursive: true,
        force: true,
      });
      await fs.writeFile(
        path.join(developmentRoot, "index.mjs"),
        `
import { createServer } from "@farm.js/core/server";

const server = await createServer({
  root: process.cwd(),
  images: { provider: "none" },
  experimental: { isolatedClientHydration: "enabled" },
});
server.config.server.host = "127.0.0.1";
await server.listen(Number(process.env.PORT));
`.trim(),
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          experimental: { isolatedClientHydration: "enabled" },
          generateBuildId: () => "isolated-scheduling-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const executablePath = await resolveInstalledChromiumExecutable();
      const verifyScheduling = async (url: string) => {
        if (!executablePath) return;
        const browser = await chromium.launch({ headless: true, executablePath });
        try {
          const page = await browser.newPage();
          const browserErrors: string[] = [];
          page.on("console", (message) => {
            if (message.type() === "error") {
              const location = message.location().url;
              if (location.endsWith("/favicon.ico")) return;
              browserErrors.push(`${message.text()} (${location})`);
            }
          });
          page.on("pageerror", (error) => browserErrors.push(error.message));
          try {
            await page.addInitScript(() => {
              const state = globalThis as any;
              state.__farmVisibleObservers = [];
              state.__farmIdleCallbacks = [];
              state.__farmIdlePending = new Map();
              state.__farmObserverDisconnects = 0;
              state.__farmIdleCancellations = 0;
              state.IntersectionObserver = class {
                callback: IntersectionObserverCallback;
                target?: Element;
                constructor(callback: IntersectionObserverCallback) {
                  this.callback = callback;
                  state.__farmVisibleObservers.push(this);
                }
                observe(target: Element) {
                  this.target = target;
                }
                disconnect() {
                  state.__farmObserverDisconnects++;
                }
              };
              let idleId = 0;
              state.requestIdleCallback = (callback: IdleRequestCallback) => {
                const id = ++idleId;
                state.__farmIdleCallbacks.push(callback);
                state.__farmIdlePending.set(id, callback);
                return id;
              };
              state.cancelIdleCallback = (id: number) => {
                state.__farmIdleCancellations++;
                state.__farmIdlePending.delete(id);
              };
            });
            await page.goto(url);

            const boundary = (strategy: string) =>
              page.locator(`farm-client-boundary[data-farm-island-strategy="${strategy}"]`);
            await boundary("load").locator('[data-strategy="load"]').waitFor();
            await expect
              .poll(() => boundary("load").getAttribute("data-farm-hydrated"))
              .toBe("true");
            for (const strategy of ["interaction", "visible", "idle"]) {
              expect(await boundary(strategy).getAttribute("data-farm-hydrated")).toBeNull();
            }

            await page.locator('[data-strategy="interaction"]').click();
            await expect
              .poll(() => page.locator('[data-strategy="interaction"]').textContent())
              .toBe("interaction:1");
            expect(await boundary("visible").getAttribute("data-farm-hydrated")).toBeNull();
            expect(await boundary("idle").getAttribute("data-farm-hydrated")).toBeNull();

            await page.evaluate(() => {
              const state = globalThis as any;
              for (const observer of state.__farmVisibleObservers) {
                observer.callback([{ isIntersecting: true, target: observer.target }], observer);
              }
            });
            await expect
              .poll(() => page.locator('[data-strategy="visible"]').textContent())
              .toBe("visible:0");
            expect(await boundary("idle").getAttribute("data-farm-hydrated")).toBeNull();

            await page.evaluate(() => {
              const state = globalThis as any;
              for (const callback of state.__farmIdleCallbacks) {
                callback({ didTimeout: false, timeRemaining: () => 10 });
              }
            });
            await expect
              .poll(() => boundary("idle").getAttribute("data-farm-hydrated"))
              .toBe("true");

            await page.evaluate(() => {
              const state = globalThis as any;
              for (const observer of state.__farmVisibleObservers) {
                observer.callback([{ isIntersecting: true, target: observer.target }], observer);
              }
              for (const callback of state.__farmIdleCallbacks) {
                callback({ didTimeout: false, timeRemaining: () => 10 });
              }
            });
            await page.locator('[data-strategy="interaction"]').click();
            await page.locator('[data-strategy="visible"]').click();
            await expect
              .poll(() => page.locator('[data-strategy="interaction"]').textContent())
              .toBe("interaction:2");
            await expect
              .poll(() => page.locator('[data-strategy="visible"]').textContent())
              .toBe("visible:1");
            await expect
              .poll(() => page.evaluate(() => (globalThis as any).__farmStrategyLifecycle.mounts))
              .toEqual(["load", "interaction", "visible", "idle"]);

            await page.reload();
            await expect
              .poll(() => boundary("load").getAttribute("data-farm-hydrated"))
              .toBe("true");
            await expect
              .poll(() => page.evaluate(() => (globalThis as any).__farmStrategyLifecycle.mounts))
              .toEqual(["load"]);
            await page.evaluate(() => {
              const state = globalThis as any;
              const queue = (state.__FARM_PREHYDRATION_CLICK_QUEUE__ ||= []);
              for (const strategy of ["interaction", "visible", "idle"]) {
                queue.push({ target: document.querySelector(`[data-strategy="${strategy}"]`) });
              }
            });
            await page.locator("[data-nav-second]").click();
            await expect.poll(() => page.locator("h1").textContent()).toBe("Second page");
            expect(
              await page.evaluate(
                () => (globalThis as any).__FARM_PREHYDRATION_CLICK_QUEUE__.length,
              ),
            ).toBe(0);
            const cleanup = await page.evaluate(() => ({
              observers: (globalThis as any).__farmObserverDisconnects,
              idle: (globalThis as any).__farmIdleCancellations,
            }));
            expect(cleanup.observers).toBeGreaterThanOrEqual(1);
            expect(cleanup.idle).toBeGreaterThanOrEqual(1);

            await page.evaluate(() => {
              const state = globalThis as any;
              for (const observer of state.__farmVisibleObservers) {
                observer.callback([{ isIntersecting: true, target: observer.target }], observer);
              }
              for (const callback of state.__farmIdleCallbacks) {
                callback({ didTimeout: false, timeRemaining: () => 10 });
              }
            });
            await page.waitForTimeout(20);
            expect(
              await page.evaluate(() => (globalThis as any).__farmStrategyLifecycle.mounts),
            ).toEqual(["load"]);
            expect(browserErrors).toEqual([]);
          } catch (error) {
            throw new Error(
              `${String(error)}\nBrowser errors:\n${browserErrors.join("\n")}\nDOM:\n${await page.locator("body").innerHTML()}`,
            );
          }
        } finally {
          await browser.close();
        }
      };

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          for (const strategy of ["load", "interaction", "visible", "idle"]) {
            expect(html).toContain(`data-farm-island-strategy="${strategy}"`);
          }
          expect(html.match(/<farm-client-boundary/g)).toHaveLength(4);
          await verifyScheduling(response.url);
        },
      );

      if (executablePath) {
        await runProductionRequest(developmentRoot, async (response) => {
          expect(response.status).toBe(200);
          await verifyScheduling(response.url);
        });
      }
    } finally {
      await Promise.all(
        [root, developmentRoot].map((fixtureRoot) =>
          fs.rm(fixtureRoot, { recursive: true, force: true }),
        ),
      );
    }
  }, 180_000);

  it("keeps one isolated ownership plan across development, HMR, SSR, and SSG", async () => {
    const [developmentRoot, streamingRoot, bufferedRoot, staticRoot] = await Promise.all([
      createIsolatedParityFixture(),
      createIsolatedParityFixture(),
      createIsolatedParityFixture(),
      createIsolatedParityFixture({ ssg: true }),
    ]);
    const roots = [developmentRoot, streamingRoot, bufferedRoot, staticRoot];
    const assertBoundaryDocument = (html: string) => {
      expect(html).toContain("Parity page");
      expect(html).toContain("SERVER_LAYOUT_SENTINEL_ISOLATED_PARITY");
      expect(readIsolatedBoundaryMetadata(html)).toEqual(isolatedParityMetadata);
    };
    const assertFallbackDocument = (html: string) => {
      expect(html).toContain("data-fallback-counter");
      expect(html).toMatch(/id="__farm_page__"[^>]*data-farm-client="true"/);
      expect(readIsolatedBoundaryMetadata(html)).toEqual(isolatedParityMetadata);
    };
    const assertProductionOwnership = async (root: string) => {
      const clientJavaScript = await readAllClientJavaScript(root);
      expect(clientJavaScript).toContain("__farm_client_boundary_originals__");
      expect(clientJavaScript).not.toContain("SERVER_LAYOUT_SENTINEL_ISOLATED_PARITY");
    };
    const resolveParityConfig = (root: string, buildId: string) =>
      resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          experimental: { isolatedClientHydration: "enabled" },
          generateBuildId: () => buildId,
        },
        "production",
      );

    try {
      await fs.writeFile(
        path.join(developmentRoot, "index.mjs"),
        `
import { createServer } from "@farm.js/core/server";

const server = await createServer({
  root: process.cwd(),
  images: { provider: "none" },
  experimental: { isolatedClientHydration: "enabled" },
});
server.config.server.host = "127.0.0.1";
await server.listen(Number(process.env.PORT));
`.trim(),
      );
      await runProductionRequest(developmentRoot, async (response) => {
        expect(response.status).toBe(200);
        assertBoundaryDocument(await response.text());
        const fallbackResponse = await fetch(new URL("/fallback", response.url));
        expect(fallbackResponse.status).toBe(200);
        assertFallbackDocument(await fallbackResponse.text());

        const executablePath = await resolveInstalledChromiumExecutable();
        if (!executablePath) return;
        const browser = await chromium.launch({ headless: true, executablePath });
        try {
          const page = await browser.newPage();
          const browserErrors: string[] = [];
          const browserRequests: string[] = [];
          page.on("request", (request) => browserRequests.push(new URL(request.url()).pathname));
          page.on("console", (message) => {
            if (message.type() === "error") {
              browserErrors.push(`${message.text()} (${message.location().url})`);
            }
          });
          page.on("pageerror", (error) => browserErrors.push(error.message));
          try {
            await page.goto(response.url);
            await expect
              .poll(() => page.locator('farm-client-boundary[data-farm-hydrated="true"]').count())
              .toBe(3);
            await page.locator("[data-parity-layout]").evaluate((element) => {
              element.setAttribute("data-layout-identity", "retained");
              (
                window as typeof window & { __farmParityHmrDocument?: string }
              ).__farmParityHmrDocument = "retained";
            });
            await page.locator('[data-live-counter="first"]').click();
            await page.locator("[data-stable-counter]").click();
            await expect
              .poll(() => page.locator('[data-live-counter="first"]').textContent())
              .toBe("before:first:1");
            await expect
              .poll(() => page.locator("[data-stable-counter]").textContent())
              .toBe("stable:1");

            await fs.writeFile(
              path.join(developmentRoot, "src", "components", "live-counter.tsx"),
              isolatedParityCounterSource("after"),
            );
            await expect
              .poll(
                () =>
                  page
                    .locator("[data-live-counter]")
                    .evaluateAll((elements) => elements.map((element) => element.textContent)),
                { timeout: 10_000 },
              )
              .toEqual(["after:first:0", "after:second:0"]);

            expect(await page.locator("[data-stable-counter]").textContent()).toBe("stable:1");
            expect(
              await page.locator("[data-parity-layout]").getAttribute("data-layout-identity"),
            ).toBe("retained");
            expect(
              await page.evaluate(
                () =>
                  (window as typeof window & { __farmParityHmrDocument?: string })
                    .__farmParityHmrDocument,
              ),
            ).toBe("retained");
            expect(
              await page.evaluate(() =>
                (
                  window as typeof window & {
                    __FARM_ISOLATED_HYDRATION_RUNTIME__?: { rootCount(): number };
                  }
                ).__FARM_ISOLATED_HYDRATION_RUNTIME__?.rootCount(),
              ),
            ).toBe(3);

            await page.locator("[data-nav-fallback]").click();
            await expect
              .poll(() => page.locator("[data-fallback-counter]").textContent())
              .toBe("fallback:0");
            await page.locator("[data-fallback-counter]").click();
            await expect
              .poll(() => page.locator("[data-fallback-counter]").textContent())
              .toBe("fallback:1");
            expect(await page.locator("[data-stable-counter]").textContent()).toBe("stable:1");
            expect(
              await page.locator("[data-parity-layout]").getAttribute("data-layout-identity"),
            ).toBe("retained");
            await page.locator("[data-nav-home]").click();
            await expect.poll(() => page.locator("[data-parity-page]").count()).toBe(1);
            expect(await page.locator("[data-stable-counter]").textContent()).toBe("stable:1");
            expect(
              await page
                .locator("[data-live-counter]")
                .evaluateAll((elements) => elements.map((element) => element.textContent)),
            ).toEqual(["after:first:0", "after:second:0"]);
            expect(
              await page.evaluate(() =>
                (
                  window as typeof window & {
                    __FARM_ISOLATED_HYDRATION_RUNTIME__?: { rootCount(): number };
                  }
                ).__FARM_ISOLATED_HYDRATION_RUNTIME__?.rootCount(),
              ),
            ).toBe(3);
            expect(browserRequests).toContain("/src/components/live-counter.tsx");
            expect(browserRequests).not.toContain("/src/app/layout.tsx");
            expect(browserRequests).not.toContain("/src/lib/server-sentinel.ts");
            expect(
              browserErrors,
              `${browserErrors.join("\n")}\nDOM:\n${await page.locator("body").innerHTML()}`,
            ).toEqual([]);
          } catch (error) {
            throw new Error(
              `${String(error)}\nBrowser errors:\n${browserErrors.join("\n")}\nRequests:\n${browserRequests.join("\n")}\nDOM:\n${await page.locator("body").innerHTML()}`,
            );
          }
        } finally {
          await browser.close();
        }
      });

      const streamingConfig = await resolveParityConfig(
        streamingRoot,
        "isolated-parity-streaming-test",
      );
      expect(streamingConfig.renderer.capabilities?.streaming?.node).toBe(true);
      await build(streamingConfig, { root: streamingRoot, preset: "node-server" });
      await assertProductionOwnership(streamingRoot);
      await runProductionRequest(
        path.join(streamingRoot, ".farm", ".output", "server"),
        async (response) => {
          assertBoundaryDocument(await response.text());
          assertFallbackDocument(
            await fetch(new URL("/fallback", response.url)).then((item) => item.text()),
          );
        },
      );

      const bufferedConfig = await resolveParityConfig(
        bufferedRoot,
        "isolated-parity-buffered-test",
      );
      bufferedConfig.renderer = {
        ...bufferedConfig.renderer,
        capabilities: { streaming: { node: false, web: false } },
      };
      expect(bufferedConfig.renderer.capabilities?.streaming?.node).toBe(false);
      await build(bufferedConfig, { root: bufferedRoot, preset: "node-server" });
      await assertProductionOwnership(bufferedRoot);
      await runProductionRequest(
        path.join(bufferedRoot, ".farm", ".output", "server"),
        async (response) => {
          assertBoundaryDocument(await response.text());
          assertFallbackDocument(
            await fetch(new URL("/fallback", response.url)).then((item) => item.text()),
          );
        },
      );

      const staticConfig = await resolveParityConfig(staticRoot, "isolated-parity-static-test");
      await build(staticConfig, { root: staticRoot, preset: "node-server" });
      await assertProductionOwnership(staticRoot);
      const staticHtml = await fs.readFile(
        path.join(staticRoot, ".farm", ".output", "public", "index.html"),
        "utf8",
      );
      assertBoundaryDocument(staticHtml);
      const staticFallbackHtml = await fs.readFile(
        path.join(staticRoot, ".farm", ".output", "public", "fallback", "index.html"),
        "utf8",
      );
      assertFallbackDocument(staticFallbackHtml);
    } finally {
      await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
    }
  }, 180_000);

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

  it("includes package client boundaries imported by a server layout in route hydration", async () => {
    const root = await createProductionFixture();

    try {
      const analyticsRoot = path.join(root, "node_modules", "@fixture", "analytics");
      await fs.mkdir(path.join(analyticsRoot, "dist", "react"), { recursive: true });
      await fs.writeFile(
        path.join(analyticsRoot, "package.json"),
        JSON.stringify(
          {
            name: "@fixture/analytics",
            type: "module",
            exports: {
              "./react": {
                import: "./dist/react/index.mjs",
              },
            },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        path.join(analyticsRoot, "dist", "react", "index.mjs"),
        `export { AnalyticsBoundary } from "./boundary.mjs";`,
      );
      await fs.writeFile(
        path.join(analyticsRoot, "dist", "react", "boundary.mjs"),
        `
"use client";

import { useEffect } from "react";

export function AnalyticsBoundary() {
  useEffect(() => {
    document.documentElement.dataset.layoutEffect = "layout-effect-fired";
  }, []);
  return null;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "layout.tsx"),
        `
import "./globals.css";
import { AnalyticsBoundary } from "@fixture/analytics/react";

export default function RootLayout({ children }) {
  return <div data-layout="root"><AnalyticsBoundary />{children}</div>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "globals.css"),
        "h1 { font-family: monospace; font-weight: 400; }",
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `export default function Page() { return <main>layout boundary page</main>; }`,
      );
      await fs.mkdir(path.join(root, "src", "app", "docs"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "docs", "page.md"),
        `# Layout boundary docs\n\nServer-rendered documentation content.`,
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          docs: { entry: "/docs", search: false },
          images: { provider: "none" },
          generateBuildId: () => "layout-client-boundary-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const clientBundle = await readClientBundle(root);
      expect(clientBundle).toContain("layout-effect-fired");
      expect(clientBundle).toContain("/docs/[...slug]");

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain('data-layout="root"');
          expect(html).toContain("layout boundary page");
          expect(html).toContain('id="__farm_page__"');
          expect(html).toContain('data-farm-client="false"');
          expect(html).toContain('data-farm-layout-client="true"');
        },
      );
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("Layout boundary docs");
          expect(html).toContain('id="root"');
          expect(html).toContain('id="__farm_page__"');
          expect(html).toContain('data-farm-client="false"');
          expect(html).toContain('data-farm-layout-client="true"');
          expect(html).toContain('id="__farm_route_slots_data__"');
          const scriptPattern = /src="\/farm-client-h[0-9a-f]{8}\.js"/g;
          expect(html.match(scriptPattern)).toHaveLength(1);
          // The stylesheet href carries a content fingerprint so browsers
          // cannot serve stale CSS against fresh HTML.
          const stylesheetPattern = /href="\/assets\/farm-client-h[0-9a-f]{8}\.css"/g;
          expect(html.match(stylesheetPattern)).toHaveLength(1);
          const clientStylesheetIndex = html.search(
            /<link rel="stylesheet" href="\/assets\/farm-client-h[0-9a-f]{8}\.css">/,
          );
          expect(clientStylesheetIndex).toBeGreaterThan(-1);
          expect(clientStylesheetIndex).toBeLessThan(html.indexOf("</head>"));
          expect(html).not.toContain("<style>");
        },
        "/docs",
      );
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
      await expect(
        fs.readFile(path.join(root, ".farm", "ssr", "nitro-entry.mjs"), "utf8"),
      ).resolves.toContain("farmNitroApp.hooks.hook('close'");

      const clientBundle = await readClientBundle(root);
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

  // Windows has no POSIX signals: child.kill("SIGTERM") maps to TerminateProcess,
  // so graceful shutdown never runs and its effects cannot be observed.
  it("drains in-flight requests and closes production resources on SIGTERM", async (ctx) => {
    if (isWindows) ctx.skip();
    const root = await createProductionFixture();
    const markerPath = path.join(root, "production-lifecycle.log");
    const apiDir = path.join(root, "src", "app", "api", "slow");
    const serverConfig = {
      gracefulShutdownTimeout: "3s" as const,
      health: {
        livenessPath: "/health/live",
        readinessPath: "/health/ready",
      },
    };

    try {
      await fs.mkdir(apiDir, { recursive: true });
      await fs.writeFile(
        path.join(apiDir, "route.ts"),
        `
import { appendFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export async function GET() {
  await appendFile(${JSON.stringify(markerPath)}, "request:start\\n");
  await delay(300);
  await appendFile(${JSON.stringify(markerPath)}, "request:finish\\n");
  return new Response("drained response");
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `
import { appendFile } from "node:fs/promises";
import { defineConfig, definePlugin } from "@farm.js/core";

const lifecyclePlugin = definePlugin({
  name: "test:production-lifecycle",
  setup(context) {
    context.lifecycle.onShutdown(async () => {
      await appendFile(${JSON.stringify(markerPath)}, "resource:closed\\n");
    });
  },
  runtime: {
    async start() {
      await appendFile(${JSON.stringify(markerPath)}, "runtime:ready\\n");
    },
    async close({ reason }) {
      await appendFile(${JSON.stringify(markerPath)}, \`runtime:closed:\${reason}\\n\`);
    },
  },
});

export default defineConfig({
  images: { provider: "none" },
  server: ${JSON.stringify(serverConfig)},
  plugins: [lifecyclePlugin],
});
`.trim(),
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          server: serverConfig,
          plugins: [
            definePlugin({
              name: "test:production-lifecycle-build-marker",
              runtime: {
                start() {},
                close() {},
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const serverDir = path.join(root, ".farm", ".output", "server");
      const port = await getAvailablePort();
      const output: string[] = [];
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

      try {
        const healthResponse = await waitForServer(
          `http://127.0.0.1:${port}/health/ready`,
          () => output.join(""),
          () => productionServer.exitCode !== null,
        );
        expect(healthResponse.status).toBe(200);
        await expect(healthResponse.json()).resolves.toMatchObject({ status: "ok" });

        const request = fetch(`http://127.0.0.1:${port}/api/slow`);
        for (let attempt = 0; attempt < 100; attempt++) {
          const marker = await fs.readFile(markerPath, "utf8").catch(() => "");
          if (marker.includes("request:start")) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(await fs.readFile(markerPath, "utf8")).toContain("request:start");

        productionServer.kill("SIGTERM");
        const response = await request;
        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toBe("drained response");

        const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (resolve, reject) => {
            const timeout = setTimeout(() => {
              productionServer.kill("SIGKILL");
              reject(new Error(`Production server did not shut down:\n${output.join("")}`));
            }, 5_000);
            productionServer.once("exit", (code, signal) => {
              clearTimeout(timeout);
              resolve({ code, signal });
            });
          },
        );
        expect(exit).toEqual({ code: 0, signal: null });
        expect((await fs.readFile(markerPath, "utf8")).trim().split("\n")).toEqual([
          "runtime:ready",
          "request:start",
          "request:finish",
          "runtime:closed:production-server-closed",
          "resource:closed",
        ]);
      } finally {
        if (productionServer.exitCode === null) productionServer.kill("SIGKILL");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  // Windows has no POSIX signals: child.kill("SIGTERM") maps to TerminateProcess,
  // so graceful shutdown never runs and its effects cannot be observed.
  it("shuts down when SIGTERM interrupts runtime startup", async (ctx) => {
    if (isWindows) ctx.skip();
    const root = await createProductionFixture();
    const markerPath = path.join(root, "production-startup-signal.log");
    const serverConfig = { gracefulShutdownTimeout: "500ms" as const };

    try {
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `
import { appendFile } from "node:fs/promises";
import { defineConfig, definePlugin } from "@farm.js/core";

const lifecyclePlugin = definePlugin({
  name: "test:startup-signal",
  setup({ lifecycle }) {
    lifecycle.onShutdown(async () => {
      await appendFile(${JSON.stringify(markerPath)}, "resource:closed\\n");
    });
  },
  runtime: {
    async start() {
      await appendFile(${JSON.stringify(markerPath)}, "runtime:starting\\n");
      await new Promise(() => setInterval(() => {}, 1_000));
    },
    async close({ reason }) {
      await appendFile(${JSON.stringify(markerPath)}, \`runtime:closed:\${reason}\\n\`);
    },
  },
});

export default defineConfig({
  images: { provider: "none" },
  server: ${JSON.stringify(serverConfig)},
  plugins: [lifecyclePlugin],
});
`.trim(),
      );

      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          server: serverConfig,
          plugins: [
            definePlugin({
              name: "test:startup-signal-build-marker",
              runtime: {
                start() {},
                close() {},
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const serverDir = path.join(root, ".farm", ".output", "server");
      const output: string[] = [];
      const productionServer = spawn(process.execPath, [path.join(serverDir, "index.mjs")], {
        cwd: serverDir,
        env: { ...process.env, HOST: "127.0.0.1", PORT: String(await getAvailablePort()) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      productionServer.stdout.on("data", (chunk) => output.push(String(chunk)));
      productionServer.stderr.on("data", (chunk) => output.push(String(chunk)));

      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          const marker = await fs.readFile(markerPath, "utf8").catch(() => "");
          if (marker.includes("runtime:starting")) break;
          if (productionServer.exitCode !== null) {
            throw new Error(`Production server exited during startup:\n${output.join("")}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(await fs.readFile(markerPath, "utf8")).toContain("runtime:starting");

        const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (resolve) => {
            productionServer.once("exit", (code, signal) => resolve({ code, signal }));
          },
        );
        productionServer.kill("SIGTERM");
        const exit = await Promise.race([
          exitPromise,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () => reject(new Error(`Production startup did not stop:\n${output.join("")}`)),
              2_000,
            ),
          ),
        ]);

        expect(exit).toEqual({ code: 0, signal: null });
        expect((await fs.readFile(markerPath, "utf8")).trim().split("\n")).toEqual([
          "runtime:starting",
          "runtime:closed:SIGTERM",
          "resource:closed",
        ]);
      } finally {
        if (productionServer.exitCode === null) productionServer.kill("SIGKILL");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps standalone production API failures generic", async () => {
    const root = await createProductionFixture();

    try {
      const failureApiDir = path.join(root, "src", "app", "api", "failure");
      const afterApiDir = path.join(root, "src", "app", "api", "after-response");
      const queryApiDir = path.join(root, "src", "app", "api", "structured-search");
      const afterMarkerPath = path.join(root, "after-response.txt");
      await fs.mkdir(failureApiDir, { recursive: true });
      await fs.mkdir(afterApiDir, { recursive: true });
      await fs.mkdir(queryApiDir, { recursive: true });
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
      await fs.writeFile(
        path.join(queryApiDir, "route.ts"),
        `
export async function QUERY(request: Request) {
  return Response.json({
    method: request.method,
    body: await request.json(),
  });
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
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          await expect(response.json()).resolves.toEqual({
            method: "QUERY",
            body: { filters: ["tools", "seeds"] },
          });
        },
        "/api/structured-search",
        {
          method: "QUERY",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filters: ["tools", "seeds"] }),
        },
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
            expect(html).toMatch(
              /<link rel="modulepreload" href="\/farm-client-h[0-9a-f]{8}\.js">/,
            );
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
