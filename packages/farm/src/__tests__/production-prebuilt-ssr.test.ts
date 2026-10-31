// @vitest-environment node

import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import { imageSize } from "image-size";
import { describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { loadFarmProductionVite, type FarmProductionViteRuntime } from "../build/production-vite";
import { loadConfig, resolveConfig } from "../config";
import { defineIntegration } from "../integrations";
import { definePlugin } from "../plugin";
import { logger } from "../utils";

const isWindows = process.platform === "win32";
// Bun is optional: the bun preset's shutdown runs only where it is installed.
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;

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
  // `export *` keeps this boundary route-wide: its export names live in another module.
  await fs.writeFile(
    path.join(root, "src", "components", "fallback-counter.tsx"),
    `
"use client";

export * from "./fallback-counter-implementation";
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "components", "fallback-counter-implementation.tsx"),
    `
"use client";

import { useState } from "react";

export function FallbackCounter() {
  const [count, setCount] = useState(0);
  return <button data-fallback-counter onClick={() => setCount((value) => value + 1)}>fallback:{count}</button>;
}
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
export const island = "interaction";

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
  return Array.from(html.matchAll(/<f-island\b([^>]*)>/g), ([, attributes]) => ({
    reference: readAttribute(attributes, "src"),
    exportName: readAttribute(attributes, "export"),
    strategy: readAttribute(attributes, "strategy"),
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

  try {
    const executablePath = chromium.executablePath();
    await fs.access(executablePath);
    return executablePath;
  } catch {
    return null;
  }
}

/** The header Farm Infra signed manifest requests with, which once unlocked a full view. */
function legacyFarmInfraSignature(key: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = createHash("sha256").update(key).digest("hex");
  const hmac = createHmac("sha256", secret).update(`farmjs-manifest-v1\n${timestamp}`);
  return `t=${timestamp}, v1=${hmac.digest("hex")}`;
}

async function runProductionRequest(
  serverDir: string,
  assertion: (response: Response) => Promise<void>,
  pathname = "/",
  requestInit?: RequestInit,
  env: Record<string, string | undefined> = {},
): Promise<void> {
  const port = await getAvailablePort();
  const output: string[] = [];
  let spawnError: Error | undefined;
  const productionServer = spawn(process.execPath, [path.join(serverDir, "index.mjs")], {
    cwd: serverDir,
    env: {
      ...process.env,
      ...env,
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

async function readJavaScriptOutput(dir: string, extensions = [".mjs"]): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return readJavaScriptOutput(entryPath, extensions);
      return extensions.some((extension) => entry.name.endsWith(extension))
        ? fs.readFile(entryPath, "utf8")
        : "";
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
  const serverPackage = await fs
    .readFile(path.join(serverDir, "package.json"), "utf8")
    .then((contents) => JSON.parse(contents))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {};
      throw error;
    });
  expect(serverPackage.imports?.["#farm-ssr-entry"]).toBeUndefined();
  await expect(fs.access(path.join(serverDir, "farm-ssr"))).rejects.toThrow();
  await expect(fs.readFile(path.join(serverDir, "index.mjs"), "utf8")).resolves.not.toContain(
    "#farm-ssr-entry",
  );
}

describe("production prebuilt SSR output", () => {
  it("finishes error reporting after another reporter fails in built Node output", async () => {
    const root = await createProductionFixture();
    const markerPath = path.join(root, "reported.json");
    try {
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `import { writeFile } from "node:fs/promises";
export default { plugins: [
  {
    name: "failing-reporter",
    runtime: { before({ request }) {
      if (new URL(request.url).pathname === "/failure") throw new Error("original request failure");
    } },
    onError() { throw new Error("reporter failure"); },
  },
  {
    name: "remaining-reporter",
    async onError({ error, phase }) {
      await writeFile(${JSON.stringify(markerPath)}, JSON.stringify({ message: error.message, phase }));
    },
  },
] };`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "error-reporter-isolation-test",
          plugins: [
            definePlugin({ name: "failing-reporter", runtime: { before() {} }, onError() {} }),
            definePlugin({ name: "remaining-reporter", onError() {} }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(500);
          await response.text();
          expect(JSON.parse(await fs.readFile(markerPath, "utf8"))).toEqual({
            message: "original request failure",
            phase: "runtime",
          });
          const healthy = await fetch(new URL("/", response.url));
          expect(healthy.status).toBe(200);
          expect(await healthy.text()).toContain("prebuilt SSR output");
        },
        "/failure",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("preserves root-to-leaf layout order in a built nested dynamic route", async () => {
    const root = await createProductionFixture();
    try {
      for (const [relative, name] of [
        ["", "root"],
        ["reports", "reports"],
        ["reports/[id]", "item"],
        ["docs/[[...slug]]", "docs"],
      ]) {
        const directory = path.join(root, "src", "app", relative);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(
          path.join(directory, "layout.tsx"),
          `export default function Layout({ children }) { return <section data-layout-order="${name}">{children}</section>; }`,
        );
      }
      const leaf = path.join(root, "src", "app", "reports", "[id]", "activity");
      await fs.mkdir(leaf, { recursive: true });
      await fs.writeFile(
        path.join(leaf, "page.tsx"),
        `export default function Page({ params }) { return <main data-layout-order="page">{params.id}</main>; }`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "docs", "[[...slug]]", "page.tsx"),
        `export default function Page({ params }) { return <main data-layout-order="page">{params.slug}</main>; }`,
      );
      const config = await resolveConfig(
        { root, srcDir: "src", images: { provider: "none" }, telemetry: false },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      const serverDir = path.join(root, ".farm", ".output", "server");
      await runProductionRequest(serverDir, async (initial) => {
        await initial.arrayBuffer();
        // Several requests to the same live server exercise reuse without leaking
        // the previous request's URL, params or selected layout array.
        for (const [pathname, order, text] of [
          ["/reports/one/activity", ["root", "reports", "item", "page"], "one"],
          ["/docs", ["root", "docs", "page"], ""],
          [
            "/reports/two%20items/activity?source=docs",
            ["root", "reports", "item", "page"],
            "two items",
          ],
          ["/docs/a%2Fb/guide", ["root", "docs", "page"], "a/b/guide"],
          ["/reports/a%252Fb/activity", ["root", "reports", "item", "page"], "a%2Fb"],
          ["/", ["root"], undefined],
        ] as const) {
          const response = await fetch(new URL(pathname, initial.url));
          expect(response.status, pathname).toBe(200);
          const html = await response.text();
          expect(
            [...html.matchAll(/data-layout-order="([^"]+)"/g)].map((match) => match[1]),
          ).toEqual(order);
          if (text !== undefined) expect(html).toContain(`>${text}</main>`);
        }
        // The Node adapter rejects malformed escapes before layout selection.
        const malformed = await fetch(new URL("/docs/%ZZ", initial.url));
        expect(malformed.status).toBe(400);
        await malformed.arrayBuffer();
        const missing = await fetch(new URL("/unknown/route", initial.url));
        expect(missing.status).toBe(404);
        await missing.arrayBuffer();
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it.each([false, true])(
    "enforces final preload budgets after HTML transforms (plugin: %s)",
    async (withPlugin) => {
      const root = await createProductionFixture();
      const plugin = definePlugin({
        name: "production-preload-transform",
        transformHTML(html) {
          return html.replace(
            "</head>",
            `<meta name="unicode-preload" content="İstanbul"><script>globalThis.__preloadLiteral = '<link rel="preload" as="image" href="/inert.webp">';</script><link rel="preload" as="image" href="/plugin.webp" fetchpriority="high"></head>`,
          );
        },
      });
      try {
        if (withPlugin)
          await fs.writeFile(
            path.join(root, "farm.config.mjs"),
            `export default { plugins: [{ name: "production-preload-transform", ${plugin.transformHTML!.toString()} }] };`,
          );
        const config = await resolveConfig(
          {
            root,
            srcDir: "src",
            images: { provider: "none" },
            telemetry: false,
            plugins: withPlugin ? [plugin] : [],
            headers: () => [
              {
                source: "/",
                headers: [
                  {
                    key: "Link",
                    value:
                      "</first.webp>; rel=preload; as=image, </second.webp>; rel=preload; as=image",
                  },
                  { key: "Set-Cookie", value: "a=1; Path=/" },
                  { key: "Set-Cookie", value: "b=2; Path=/" },
                ],
              },
            ],
            generateBuildId: () => "preload-buffered-response-test",
          },
          "production",
        );
        await build(config, { root, preset: "node-server" });
        await runProductionRequest(
          path.join(root, ".farm", ".output", "server"),
          async (response) => {
            expect(response.status).toBe(200);
            expect(response.headers.has("x-farm-preload-buffered")).toBe(false);
            expect(response.headers.has("x-farm-preload-streaming")).toBe(false);
            expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
            const html = await response.text();
            expect(html).toContain("prebuilt SSR output");
            if (withPlugin) {
              expect(html).toContain('href="/plugin.webp"');
              expect(html).toContain(
                `globalThis.__preloadLiteral = '<link rel="preload" as="image" href="/inert.webp">';`,
              );
              expect(response.headers.get("link") || "").not.toContain(".webp");
            } else {
              expect(response.headers.get("link")).toContain("/first.webp");
              expect(response.headers.get("link")).not.toContain("/second.webp");
            }
          },
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it.each([true, false])(
    "keeps the MDX compiler out of TSX-only output (Markdown mirrors: %s)",
    async (markdownMirrors) => {
      const root = await createProductionFixture();
      const emittedModules = new Set<string>();

      try {
        const config = await resolveConfig(
          {
            root,
            srcDir: "src",
            md: markdownMirrors,
            images: { provider: "none" },
            telemetry: false,
            generateBuildId: () => "markdown-response-boundary-test",
            vite: {
              plugins: [
                {
                  name: "record-emitted-markdown-dependencies",
                  generateBundle(_options, bundle) {
                    for (const output of Object.values(bundle)) {
                      if (output.type !== "chunk") continue;
                      for (const id of Object.keys(output.modules)) {
                        emittedModules.add(id.replace(/\\/g, "/"));
                      }
                    }
                  },
                },
              ],
            },
          },
          "production",
        );

        await build(config, { root, preset: "node-server" });
        const serverDir = path.join(root, ".farm", ".output", "server");
        await fs.access(path.join(serverDir, "farm-ssr"));
        expect([...emittedModules].some((id) => id.includes("virtual:farm-ssr-entry"))).toBe(true);
        // Inspect module provenance in every emitted chunk, including dynamic chunks.
        // A renamed output file must not conceal an accidentally bundled compiler.
        expect(
          [...emittedModules].filter((id) =>
            /\/(?:@mdx-js\/|remark-[^/]+\/|micromark(?:-[^/]+)?\/)/.test(id),
          ),
        ).toEqual([]);

        await runProductionRequest(serverDir, async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("prebuilt SSR output");
          // The head advertises the mirror exactly when the Link header does.
          const markdownLink = '<link rel="alternate" href="/index.md" type="text/markdown">';
          if (markdownMirrors) {
            expect(response.headers.get("link")).toContain(
              '</index.md>; rel="alternate"; type="text/markdown"',
            );
            expect(html).toContain(markdownLink);
          } else {
            expect(response.headers.get("link") ?? "").not.toContain("text/markdown");
            expect(html).not.toContain('type="text/markdown"');
          }

          for (const [pathname, accept] of [
            ["/missing.md", "text/html"],
            ["/missing", "text/markdown"],
          ]) {
            const missing = await fetch(new URL(pathname, response.url), {
              headers: { accept },
            });
            expect(missing.status).toBe(404);
            expect(missing.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
            const body = await missing.text();
            expect(body).toContain("# Page not found");
            expect(body).toContain(pathname);
            expect(body).toContain("](/)");

            const head = await fetch(new URL(pathname, response.url), {
              method: "HEAD",
              headers: { accept },
            });
            expect(head.status).toBe(404);
            expect(head.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
            expect(await head.text()).toBe("");
          }

          const html404 = await fetch(new URL("/missing", response.url), {
            headers: { accept: "text/html, text/markdown;q=0" },
          });
          expect(html404.status).toBe(404);
          expect(html404.headers.get("content-type")).toContain("text/html");
          expect(await html404.text()).toContain("404");

          if (markdownMirrors) {
            const mirror = await fetch(response.url, { headers: { accept: "text/markdown" } });
            expect(mirror.status).toBe(200);
            expect(mirror.headers.get("content-type")).toContain("text/markdown");
            expect(await mirror.text()).toContain("prebuilt SSR output");
          }
        });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("renders layout and page JSON-LD next to the site-level script", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "layout.tsx"),
        `
export const metadata = {
  openGraph: { siteName: "Farm Shop" },
  jsonLd: { "@context": "https://schema.org", "@type": "WebSite", name: "Farm Shop" },
};

export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
export const metadata = {
  jsonLd: [
    { "@context": "https://schema.org", "@type": "Article", headline: "</script><script>alert(1)</script>" },
  ],
};

export default function Page() {
  return <main>json-ld page</main>;
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          agent: { jsonLd: true },
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "json-ld-production-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          const head = html.slice(0, html.indexOf("</head>"));
          const scripts = [
            ...head.matchAll(/<script type="application\/ld\+json"([^>]*)>(.*?)<\/script>/g),
          ];

          // Site identity first and unmarked, then layout and page entries, marked.
          expect(scripts.map(([, attributes]) => attributes.trim())).toEqual([
            "",
            "data-farm-metadata",
            "data-farm-metadata",
          ]);
          expect(scripts.map(([, , json]) => JSON.parse(json!)["@type"])).toEqual([
            "Organization",
            "WebSite",
            "Article",
          ]);
          expect(JSON.parse(scripts[2]![2]!).headline).toBe("</script><script>alert(1)</script>");
          expect(head).not.toContain("<script>alert(1)");
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("lists a page's client modules as modulepreload links in the document head", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "layout.tsx"),
        `
export default function RootLayout({ children }) {
  return <html><head><title>Preloads</title></head><body>{children}</body></html>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "counter.tsx"),
        `
"use client";
import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>count {count}</button>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import { Counter } from "./counter";

export default function Page() {
  return <main><Counter /></main>;
}
`.trim(),
      );
      await fs.mkdir(path.join(root, "src", "app", "islands"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "islands", "page.tsx"),
        `
import { Counter } from "../counter";

export default async function IslandsPage() {
  return <main><h1>islands</h1><Counter /></main>;
}
`.trim(),
      );
      const userConfig = {
        root,
        srcDir: "src",
        images: { provider: "none" },
        telemetry: false,
        generateBuildId: () => "client-module-preloads-test",
        // A vendor chunk the entry imports statically, as the shared chunks of a larger app are.
        vite: {
          plugins: [
            {
              name: "react-vendor-chunk",
              applyToEnvironment: (environment: { name: string }) => environment.name === "client",
              outputOptions: (options: Record<string, unknown>) => ({
                ...options,
                codeSplitting: {
                  groups: [
                    {
                      name: "react-vendor",
                      test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                    },
                  ],
                },
              }),
            },
          ],
        },
      };
      const config = await resolveConfig(userConfig, "production");
      await build(config, { root, preset: "node-server" });

      const publicDir = path.join(root, ".farm", ".output", "public");
      const entry = (await fs.readdir(publicDir)).find((name) =>
        /^farm-client-h[0-9a-f]+\.js$/.test(name),
      );
      expect(entry).toBeDefined();
      const entryCode = await fs.readFile(path.join(publicDir, entry!), "utf8");
      const manifest = JSON.parse(
        await fs.readFile(path.join(root, ".farm", "client-module-preloads.json"), "utf8"),
      ) as { files: string[]; entry: number[]; modules: Record<string, number[]> };
      const entryImports = manifest.entry.map((index) => manifest.files[index]!);
      const moduleChunk = (moduleId: string) => manifest.files[manifest.modules[moduleId]![0]!]!;
      expect(entryImports.length).toBeGreaterThan(0);
      // The entry imports the first one statically.
      expect(entryCode).toMatch(
        new RegExp(
          `(?:import|from)\\s*["'\`]\\./${entryImports[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`,
        ),
      );

      const preloadsIn = async (html: string) => {
        const head = html.slice(0, html.indexOf("</head>"));
        const files = [
          ...head.matchAll(/<link rel="modulepreload" href="\/([^"]+)" fetchpriority="low">/g),
        ].map(([, file]) => file!);
        expect(new Set(files).size).toBe(files.length);
        expect(files).not.toContain(entry);
        await Promise.all(files.map((file) => fs.access(path.join(publicDir, file))));
        // After the stylesheet, so the first paint's CSS is requested first.
        expect(head.indexOf('rel="stylesheet"')).toBeLessThan(head.indexOf('rel="modulepreload"'));
        return files;
      };

      const serverDir = path.join(root, ".farm", ".output", "server");
      // A hydrating page: the entry's imports, then the page module the entry imports on start.
      await runProductionRequest(serverDir, async (response) => {
        expect(response.status).toBe(200);
        const files = await preloadsIn(await response.text());
        expect(files.slice(0, entryImports.length)).toEqual(entryImports);
        expect(files).toContain(moduleChunk("/src/app/page.tsx"));
      });
      // An async page: the client component its island loads.
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain('<f-island src="/src/app/counter.tsx"');
          const files = await preloadsIn(html);
          expect(files).toContain(moduleChunk("/src/app/counter.tsx"));
          expect(files).not.toContain(moduleChunk("/src/app/page.tsx"));
        },
        "/islands",
      );
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(404);
          expect(await preloadsIn(await response.text())).toEqual(entryImports);
        },
        "/missing",
      );

      // A nonce policy blocks parser-inserted links without the nonce, so nonce mode lists none.
      await build(
        await resolveConfig(
          { ...userConfig, security: { csp: { nonce: true, policy: "script-src 'self'" } } },
          "production",
        ),
        { root, preset: "node-server" },
      );
      await runProductionRequest(serverDir, async (response) => {
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('data-farm-island="page"');
        expect(html).not.toContain('rel="modulepreload" href="/chunks/');
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("gives a fresh CSP nonce to Farm's scripts and opted-in app scripts only", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import { getCspNonce } from "@farm.js/core";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }) {
  const { bio = "" } = await searchParams;
  return (
    <main data-csp-nonce-page>
      Nonce-protected production output
      <script data-app="stale" nonce="stale-build-nonce" dangerouslySetInnerHTML={{ __html: "window.city='İİİİİİİİ 🌱';" }} />
      <script data-app="opted-in" nonce={getCspNonce()} dangerouslySetInnerHTML={{ __html: "window.appReady=true" }} />
      <div dangerouslySetInnerHTML={{ __html: bio }} />
    </main>
  );
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-csp-nonce-test",
          security: {
            csp: {
              nonce: true,
              policy: "default-src 'self'; script-src 'self'",
            },
          },
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      const injected = encodeURIComponent(
        '<script data-app="injected">window.pwned=1</script>' +
          '<script data-app="guessed" nonce="guessed">window.pwned=2</script>',
      );
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const firstResponse = await fetch(new URL(`/?bio=${injected}`, response.url));
          const firstPolicy = firstResponse.headers.get("content-security-policy") ?? "";
          const firstNonce = firstPolicy.match(/'nonce-([^']+)'/)?.[1];
          const firstHtml = await firstResponse.text();
          const firstScripts = Array.from(firstHtml.matchAll(/<script\b[^>]*>/gi), ([tag]) => tag);
          const appScripts = firstScripts.filter((tag) => tag.includes("data-app="));
          // Data blocks never run, so they need no nonce.
          const frameworkScripts = firstScripts.filter(
            (tag) => !tag.includes("data-app=") && !tag.includes('type="application/json"'),
          );
          const appScript = (name: string) =>
            appScripts.find((tag) => tag.includes(`data-app="${name}"`));

          expect(firstNonce).toBeTruthy();
          expect(firstPolicy).not.toContain("'unsafe-inline'");
          expect(firstHtml).toContain("window.city='İİİİİİİİ 🌱';");
          expect(firstHtml).toContain("window.pwned=1");
          // The inline bootstrap and the client entry.
          expect(frameworkScripts.length).toBeGreaterThanOrEqual(2);
          expect(frameworkScripts.every((tag) => tag.includes(`nonce="${firstNonce}"`))).toBe(true);
          expect(frameworkScripts.some((tag) => /type="module"[^>]*src=/.test(tag))).toBe(true);
          expect(appScript("opted-in")).toContain(`nonce="${firstNonce}"`);
          for (const name of ["stale", "injected", "guessed"]) {
            expect(appScript(name)).toBeDefined();
            expect(appScript(name)).not.toMatch(/\bnonce\s*=/i);
          }

          const secondResponse = await fetch(response.url);
          const secondPolicy = secondResponse.headers.get("content-security-policy") ?? "";
          const secondNonce = secondPolicy.match(/'nonce-([^']+)'/)?.[1];
          const secondHtml = await secondResponse.text();
          const secondScripts = Array.from(
            secondHtml.matchAll(/<script\b[^>]*>/gi),
            ([tag]) => tag,
          );

          expect(secondNonce).toBeTruthy();
          expect(secondNonce).not.toBe(firstNonce);
          expect(secondHtml).not.toContain(firstNonce!);
          expect(secondScripts.find((tag) => tag.includes('data-app="opted-in"'))).toContain(
            `nonce="${secondNonce}"`,
          );
          expect(
            secondScripts
              .filter(
                (tag) => !tag.includes("data-app=") && !tag.includes('type="application/json"'),
              )
              .every((tag) => tag.includes(`nonce="${secondNonce}"`)),
          ).toBe(true);
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("runs Farm's scripts and blocks injected ones in the browser under a nonce CSP", async () => {
    const executablePath = await resolveInstalledChromiumExecutable();
    if (!executablePath) return;
    const root = await createProductionFixture();
    try {
      await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "components", "counter.tsx"),
        `
"use client";
import { useState } from "react";
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button data-counter onClick={() => setCount((value) => value + 1)}>count:{count}</button>;
}`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "content.tsx"),
        `export default function Content() { return <p id="nonce-reveal">revealed</p>; }`,
      );
      // A revalidated page: shared caches may keep it, so every response must
      // still carry its own nonce on Farm's scripts.
      await fs.mkdir(path.join(root, "src", "app", "isr"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "isr", "page.tsx"),
        `
import Counter from "../../components/counter";
export const revalidate = 60;
export default function Page() {
  return (
    <main>
      <div dangerouslySetInnerHTML={{ __html: '<script>window.pwned="isr"</script>' }} />
      <Counter />
    </main>
  );
}`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import React, { lazy, Suspense } from "react";
import { getCspNonce } from "@farm.js/core";
import Counter from "../components/counter";
export const dynamic = "force-dynamic";
const Content = lazy(() => import("./content"));
export default async function Page({ searchParams }) {
  const { bio = "" } = await searchParams;
  return (
    <main>
      <script nonce={getCspNonce()} dangerouslySetInnerHTML={{ __html: "window.appReady=true" }} />
      <div dangerouslySetInnerHTML={{ __html: bio }} />
      <Counter />
      <Suspense fallback={<p id="nonce-loading">loading</p>}><Content /></Suspense>
    </main>
  );
}`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-csp-nonce-browser-test",
          security: { csp: { nonce: true, policy: "default-src 'self'; script-src 'self'" } },
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const browser = await chromium.launch({ headless: true, executablePath });
          try {
            const page = await browser.newPage();
            const violations: string[] = [];
            page.on("console", (message) => {
              if (/Content Security Policy/.test(message.text())) violations.push(message.text());
            });
            const bio = encodeURIComponent(
              '<script>window.pwned="script"</script>' +
                '<script nonce="guess">window.pwned="guessed"</script>',
            );
            await page.goto(new URL(`/?bio=${bio}`, response.url).toString());
            await page.locator("#nonce-reveal").waitFor({ state: "visible" });
            await page.locator("[data-counter]").click();
            await expect.poll(() => page.locator("[data-counter]").textContent()).toBe("count:1");
            expect(await page.evaluate(() => (window as any).appReady)).toBe(true);
            expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
            expect(violations.length).toBeGreaterThanOrEqual(2);

            const isrNonces: string[] = [];
            for (let visit = 0; visit < 2; visit++) {
              const isr = await page.goto(new URL("/isr", response.url).toString());
              const policy = isr!.headers()["content-security-policy"] ?? "";
              const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
              const isrHtml = await isr!.text();
              // Farm's executable scripts; the injected one is checked below.
              const tags = Array.from(
                isrHtml.matchAll(/<script\b[^>]*>(?!window\.pwned)/gi),
                ([tag]) => tag,
              );
              expect(nonce).toBeTruthy();
              expect(isr!.headers()["cache-control"]).toContain("s-maxage=60");
              isrNonces.push(nonce!);
              for (const tag of tags) {
                if (tag.includes("application/json")) continue;
                expect(tag).toContain(`nonce="${nonce}"`);
              }
              expect(tags.length).toBeGreaterThanOrEqual(2);
              expect(isrHtml).toContain('<script>window.pwned="isr"</script>');
              await page.locator("[data-counter]").click();
              await expect.poll(() => page.locator("[data-counter]").textContent()).toBe("count:1");
              expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
            }
            expect(isrNonces[1]).not.toBe(isrNonces[0]);
          } finally {
            await browser.close();
          }
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
    "preserves Unicode full-document Suspense output with $label",
    async ({ useReact18 }) => {
      const root = await createProductionFixture();
      try {
        if (useReact18) await linkReact18(root);
        await fs.writeFile(
          path.join(root, "src", "app", "content.tsx"),
          `
export default function Content() { return <p id="unicode-reveal">stream complete</p>; }
`,
        );
        await fs.writeFile(
          path.join(root, "src", "app", "page.tsx"),
          `
import React, { lazy, Suspense } from "react";
export const dynamic = "force-dynamic";
const Content = lazy(() => import("./content"));
export default function Page() {
  return <main><p>İstanbul 🌱</p><Suspense fallback={<p id="unicode-loading">loading</p>}><Content /></Suspense></main>;
}`,
        );
        const config = await resolveConfig(
          {
            root,
            srcDir: "src",
            images: { provider: "none" },
            telemetry: false,
            generateBuildId: () => "production-unicode-document-test",
          },
          "production",
        );
        await build(config, { root, preset: "node-server" });
        await runProductionRequest(
          path.join(root, ".farm", ".output", "server"),
          async (response) => {
            expect(response.status).toBe(200);
            const html = await response.text();
            expect(html).toContain("İstanbul 🌱");
            expect(html).toContain('id="unicode-loading"');
            expect(html).toContain('id="unicode-reveal"');
            expect(html).toContain("$RC");
            expect(html.match(/<html\b/gi)).toHaveLength(1);
            expect(html.slice(html.lastIndexOf("</html>") + 7).trim()).toBe("");
            expect(html.indexOf('id="unicode-reveal"')).toBeLessThan(html.lastIndexOf("</body>"));
            const executablePath = await resolveInstalledChromiumExecutable();
            if (executablePath) {
              const browser = await chromium.launch({ headless: true, executablePath });
              try {
                const page = await browser.newPage();
                const errors: string[] = [];
                page.on("pageerror", (error) => errors.push(error.message));
                const headers = Object.fromEntries(response.headers);
                delete headers["content-encoding"];
                delete headers["content-length"];
                // Inspect this first, suspended response, not a second render with
                // an already-resolved lazy import. Assets still use the real server.
                await page.route(
                  response.url,
                  (route) =>
                    route.fulfill({
                      status: response.status,
                      headers,
                      body: html,
                    }),
                  { times: 1 },
                );
                await page.goto(response.url);
                await page.locator("#unicode-reveal").waitFor({ state: "visible" });
                expect(await page.locator("#unicode-loading").count()).toBe(0);
                expect(await page.locator("#unicode-reveal").textContent()).toBe("stream complete");
                expect(errors).toEqual([]);
              } finally {
                await browser.close();
              }
            }
          },
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("hashes only Farm's and opted-in inline scripts in prerendered production HTML", async () => {
    const root = await createProductionFixture();
    try {
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import { getCspNonce } from "@farm.js/core";
export const ssg = true;
export default function Page() {
  return <main>İstanbul
    <script data-app="opted-in" nonce={getCspNonce()} dangerouslySetInnerHTML={{ __html: "window.city='İİİİİİİİ 🌱';" }} />
    <script data-app="stale" nonce="old" dangerouslySetInnerHTML={{ __html: "window.stale=true" }} />
    <script data-app="cms" dangerouslySetInnerHTML={{ __html: "window.cms=true" }} />
  </main>;
}`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-csp-unicode-hash-test",
          security: { csp: { nonce: true, policy: "script-src 'self'" } },
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          const policy = response.headers.get("content-security-policy");
          expect(html).toContain("window.city='İİİİİİİİ 🌱';");
          expect(html).not.toMatch(/<script\b[^>]*\bnonce\s*=/i);
          expect(policy).not.toContain("'nonce-");
          const hashOf = (content: string) =>
            `'sha256-${createHash("sha256").update(content).digest("base64")}'`;
          const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
            ([, attributes]) =>
              !/(?:^|\s)src\s*=/i.test(attributes!) && !attributes!.includes("application/json"),
          );
          const framework = inline.filter(([, attributes]) => !attributes!.includes("data-app="));
          expect(framework.length).toBeGreaterThanOrEqual(1);
          for (const [, , content] of framework) expect(policy).toContain(hashOf(content!));
          expect(policy).toContain(hashOf("window.city='İİİİİİİİ 🌱';"));
          expect(policy).not.toContain(hashOf("window.stale=true"));
          expect(policy).not.toContain(hashOf("window.cms=true"));
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("matches application routes beneath the configured basePath", async () => {
    const root = await createProductionFixture();

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          basePath: "/workspace",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-base-path-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("prebuilt SSR output");
          expect(html.match(/<html[\s>]/gi)).toHaveLength(1);
          expect(html.match(/<body[\s>]/gi)).toHaveLength(1);
          expect(html).not.toContain('data-farm-layout-boundary="true"');
        },
        "/workspace",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("applies the app's vite config to the client and server builds", async () => {
    const root = await createProductionFixture();

    try {
      await fs.mkdir(path.join(root, "vendor"), { recursive: true });
      await fs.writeFile(
        path.join(root, "vendor", "user-alias-target.ts"),
        `export const aliasedLabel = "user alias resolved";`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "marker.module.css"),
        `.title { color: rgb(1, 2, 3); }`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "user-vite-marker.tsx"),
        `
"use client";

import { aliasedLabel } from "user-vite-alias";
import styles from "./marker.module.css";

declare const __USER_VITE_FLAG__: string;

export default function UserViteMarker() {
  return <p className={styles.title} data-user-vite={__USER_VITE_FLAG__}>{aliasedLabel}</p>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import UserViteMarker from "./user-vite-marker";

export default function Page() {
  return <main>prebuilt SSR output <UserViteMarker /></main>;
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-user-vite-config-test",
          vite: {
            define: { __USER_VITE_FLAG__: JSON.stringify("user-define-applied") },
            resolve: {
              alias: { "user-vite-alias": path.join(root, "vendor", "user-alias-target.ts") },
            },
            css: { modules: { generateScopedName: "user-vite-[local]" } },
            // Options Farm owns for the production output stay under Farm's control.
            root: path.join(root, "elsewhere"),
            base: "/elsewhere/",
            mode: "development",
            build: {
              outDir: "elsewhere",
              emptyOutDir: false,
              ssr: true,
              write: false,
              rollupOptions: {
                input: "missing-entry.js",
                output: { format: "cjs", entryFileNames: "elsewhere.js" },
              },
            },
          },
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      const clientJavaScript = await readAllClientJavaScript(root);
      expect(clientJavaScript).toContain("user-define-applied");
      expect(clientJavaScript).toContain("user alias resolved");
      expect(clientJavaScript).not.toContain("__USER_VITE_FLAG__");
      expect(
        await fs.readFile(path.join(root, ".farm", "client", "farm-client.css"), "utf8"),
      ).toContain(".user-vite-title");

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain('data-user-vite="user-define-applied"');
          expect(html).toContain("user alias resolved");
          expect(html).toContain('class="user-vite-title"');
        },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("serves OpenAPI routes and Markdown alternates beneath the configured basePath", async () => {
    const root = await createProductionFixture();

    try {
      await fs.mkdir(path.join(root, "src", "app", "api", "health"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "api", "health", "route.ts"),
        `export function GET() { return Response.json({ ok: true }); }`,
      );
      await fs.mkdir(path.join(root, "src", "app", "admin"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "admin", "page.tsx"),
        `export default function Admin() { return <main>admin page</main>; }`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          basePath: "/workspace",
          images: { provider: "none" },
          telemetry: false,
          openapi: { enabled: true, title: "Base Path API" },
          agent: { apiCatalog: true },
          generateBuildId: () => "production-base-path-openapi-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          expect(await response.text()).toContain("<title>Base Path API</title>");

          const spec = await fetch(new URL("/workspace/openapi.json", response.url));
          expect(spec.status).toBe(200);
          expect((await spec.json()).paths["/health"].get.operationId).toBe("get_health");

          const catalog = await fetch(new URL("/workspace/.well-known/api-catalog", response.url));
          expect(catalog.status).toBe(200);
          expect(catalog.headers.get("content-type")).toContain("application/linkset+json");
          expect(catalog.headers.get("link")).toBe(
            '</workspace/.well-known/api-catalog>; rel="api-catalog"',
          );
          const [, catalogApi] = (await catalog.json()).linkset;
          // The links resolve on the production server, as in development.
          expect((await fetch(new URL(`${catalogApi.anchor}/health`, response.url))).status).toBe(
            200,
          );
          expect(
            (await fetch(new URL(catalogApi["service-desc"][0].href, response.url))).status,
          ).toBe(200);

          const page = await fetch(new URL("/workspace/admin", response.url), {
            headers: { accept: "text/html" },
          });
          expect(page.status).toBe(200);
          expect(page.headers.get("link")).toContain("</workspace/admin.md>");
          expect(await page.text()).toContain('href="/workspace/admin.md"');

          const markdown = await fetch(new URL("/workspace/admin.md", response.url));
          expect(markdown.status).toBe(200);
          expect(await markdown.text()).toContain("admin page");
        },
        "/workspace/docs/reference",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("lists the MCP server in /.well-known/ai-catalog.json, its card, and llms.txt", async () => {
    const root = await createProductionFixture();
    // What @farm.js/mcp does when it mounts its endpoint.
    const plugin = `{
    name: "farm:api-mcp",
    routes: ({ route }) => {
      _publishFarmMCPCatalog(
        { name: "fixture", version: "2.0.0", path: "/api/mcp", title: "Fixture" },
        [],
        { protocolVersions: ["2025-11-25"] },
      );
      return [route.post("/api/mcp", { handler: () => Response.json({ ok: true }) })];
    },
  }`;

    try {
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `import { _publishFarmMCPCatalog } from "@farm.js/core/api/runtime";
export default { basePath: "/workspace", plugins: [${plugin}] };`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          basePath: "/workspace",
          images: { provider: "none" },
          telemetry: false,
          plugins: [
            definePlugin({
              name: "farm:api-mcp",
              routes: ({ route }) => [
                route.post("/api/mcp", { handler: () => Response.json({ ok: true }) }),
              ],
            }),
          ],
          generateBuildId: () => "production-ai-catalog-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe(
            "application/ai-catalog+json; charset=utf-8",
          );
          const origin = new URL(response.url).origin;
          const { entries } = await response.json();
          expect(entries).toEqual([
            expect.objectContaining({
              identifier: "urn:air:127.0.0.1:mcp:fixture",
              type: "application/mcp-server-card+json",
              url: `${origin}/api/mcp/server-card`,
              displayName: "Fixture",
            }),
          ]);

          const ard = await fetch(`${origin}/workspace/.well-known/ard.json`);
          expect((await ard.json()).entries).toEqual(entries);

          // The card is served below the endpoint, before the API routes answer.
          const card = await fetch(entries[0].url);
          expect(card.status).toBe(200);
          expect(card.headers.get("access-control-allow-origin")).toBe("*");
          expect(await card.json()).toMatchObject({
            version: "2.0.0",
            title: "Fixture",
            remotes: [
              {
                type: "streamable-http",
                url: `${origin}/api/mcp`,
                supportedProtocolVersions: ["2025-11-25"],
              },
            ],
          });
          const etag = card.headers.get("etag")!;
          expect((await fetch(entries[0].url, { headers: { "if-none-match": etag } })).status).toBe(
            304,
          );
          expect((await fetch(`${origin}/api/mcp`, { method: "POST" })).status).toBe(200);

          const llms = await (await fetch(`${origin}/workspace/llms.txt`)).text();
          expect(llms).toContain("## MCP");
          expect(llms).toContain(`- [Fixture](${origin}/api/mcp)`);
          expect(llms).toContain(`(${origin}/workspace/.well-known/ai-catalog.json)`);
        },
        "/workspace/.well-known/ai-catalog.json",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("lists the MCP endpoint a docs runtime registers, without @farm.js/mcp", async () => {
    const root = await createProductionFixture();
    // A docs runtime like @farming-labs/farmjs: it knows its MCP route, name, and version.
    await fs.mkdir(path.join(root, "node_modules", "fake-docs-adapter"), { recursive: true });
    await fs.writeFile(
      path.join(root, "node_modules", "fake-docs-adapter", "package.json"),
      JSON.stringify({
        name: "fake-docs-adapter",
        type: "module",
        exports: { "./server": "./server.js", "./react": "./react.js" },
      }),
    );
    await fs.writeFile(
      path.join(root, "node_modules", "fake-docs-adapter", "server.js"),
      `export function createFarmDocsRuntimeHandler(_config, options) {
  options.registerMCPServer?.({
    name: "dev.farmjs/docs",
    version: "0.2.121",
    title: "Fixture Docs",
    path: "/api/docs/mcp",
  });
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/docs/mcp/server-card") return new Response("adapter card");
    return pathname === "/api/docs/mcp" ? Response.json({ mcp: true }) : null;
  };
}`,
    );
    await fs.writeFile(
      path.join(root, "node_modules", "fake-docs-adapter", "react.js"),
      "export function hydrateFarmDocs() {}",
    );
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "guide.md"), "# Guide\n");

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          // The docs MCP is not an API route, so the API's public path never moves it.
          api: { basePath: "/v1" },
          agent: { llmsTxt: { full: false } },
          docs: {
            enabled: true,
            entry: "/docs",
            contentDir: "docs",
            adapter: {
              id: "fake",
              protocol: 1,
              server: "fake-docs-adapter/server",
              react: "fake-docs-adapter/react",
            },
          },
          generateBuildId: () => "production-docs-mcp-catalog-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const origin = new URL(response.url).origin;
          const { entries } = await response.json();
          expect(entries).toEqual([
            expect.objectContaining({
              identifier: "urn:air:127.0.0.1:mcp:docs",
              url: `${origin}/api/docs/mcp/server-card`,
              displayName: "Fixture Docs",
              version: "0.2.121",
            }),
          ]);

          // Core answers the card before the docs runtime, as in dev.
          const card = await fetch(entries[0].url);
          expect(card.headers.get("content-type")).toBe(
            "application/mcp-server-card+json; charset=utf-8",
          );
          expect(await card.json()).toMatchObject({
            name: "dev.farmjs/docs",
            remotes: [{ type: "streamable-http", url: `${origin}/api/docs/mcp` }],
          });
          expect(await (await fetch(`${origin}/api/docs/mcp`)).json()).toEqual({ mcp: true });

          const llms = await (await fetch(`${origin}/llms.txt`)).text();
          expect(llms).toContain("## MCP");
          expect(llms).toContain(`- [Fixture Docs](${origin}/api/docs/mcp)`);
        },
        "/.well-known/ai-catalog.json",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("reads server env where the server runs instead of storing it in the build output", async () => {
    const root = await createProductionFixture();
    const previous = process.env.FARM_TEST_DATABASE_URL;
    process.env.FARM_TEST_DATABASE_URL = "postgres://build-time-secret";

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import { getEnv } from "@farm.js/core/env";

export default function Page() {
  return <main data-env={String(getEnv("FARM_TEST_DATABASE_URL"))}>env</main>;
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          env: { server: { FARM_TEST_DATABASE_URL: (value: string | undefined) => value } },
          generateBuildId: () => "production-runtime-env-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });
      delete process.env.FARM_TEST_DATABASE_URL;

      expect(
        await readJavaScriptOutput(path.join(root, ".farm"), [".mjs", ".js", ".cjs", ".json"]),
      ).not.toContain("build-time-secret");

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          expect(await response.text()).toContain('data-env="postgres://rotated-secret"');
        },
        "/",
        undefined,
        { FARM_TEST_DATABASE_URL: "postgres://rotated-secret" },
      );
    } finally {
      if (previous === undefined) delete process.env.FARM_TEST_DATABASE_URL;
      else process.env.FARM_TEST_DATABASE_URL = previous;
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("answers the Markdown mirror of a sign-in-protected page with its redirect", async () => {
    const root = await createProductionFixture();

    try {
      await fs.mkdir(path.join(root, "src", "app", "account"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "account", "page.tsx"),
        `
import { redirect } from "@farm.js/core/navigation";

export default function Account() {
  redirect("/login?next=%2Faccount");
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-markdown-redirect-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          // Before, the mirror gave up on the bodiless redirect and the request fell
          // through to a 404 saying the page had not been published.
          expect(response.status).toBe(307);
          expect(response.headers.get("location")).toBe("/login?next=%2Faccount");
          expect(await response.text()).toContain("redirects to");
        },
        "/account.md",
        { redirect: "manual" },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("describes a page's forms at its Markdown mirror's ?actions view", async () => {
    const root = await createProductionFixture();

    try {
      await fs.mkdir(path.join(root, "src", "app", "contact"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "contact", "page.tsx"),
        `export default function Contact() {
  return (
    <main>
      <h1>Contact</h1>
      <form method="post" action="/api/contact">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        <button>Send</button>
      </form>
    </main>
  );
}`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-markdown-actions-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });
      const serverDir = path.join(root, ".farm", ".output", "server");
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(200);
          expect(await response.text()).toContain("Actions: /contact.md?actions");

          const actions = await fetch(new URL("/contact.md?actions", response.url));
          expect(actions.status).toBe(200);
          expect(actions.headers.get("content-type")).toBe("application/json; charset=utf-8");
          expect((await actions.json()).actions).toEqual([
            {
              type: "form",
              method: "POST",
              action: "/api/contact",
              enctype: "application/x-www-form-urlencoded",
              fields: [{ name: "email", type: "email", label: "Email", required: true }],
              submit: [{ label: "Send" }],
            },
          ]);

          // The other views reach the production mirror too: a page that fits a
          // budget comes back whole, and a bad cursor is reported, not ignored.
          const outline = await fetch(new URL("/contact.md?outline", response.url));
          expect(await outline.text()).toContain("- [Contact](/contact.md?section=contact)");
          const budgeted = await fetch(new URL("/contact.md?max_tokens=100", response.url));
          expect(budgeted.status).toBe(200);
          expect(budgeted.headers.get("link") ?? "").not.toContain('rel="next"');
          expect(await budgeted.text()).toContain("# Contact");
          const stale = await fetch(
            new URL("/contact.md?max_tokens=100&cursor=1.stale", response.url),
          );
          expect(stale.status).toBe(409);
        },
        "/contact.md",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("advertises the Markdown mirror of a prerendered page", async () => {
    const root = await createProductionFixture();

    try {
      await fs.mkdir(path.join(root, "src", "app", "pricing"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "pricing", "page.tsx"),
        `export const dynamic = "force-static";\nexport default function Pricing() { return <main><h1>Pricing</h1><p>Plans.</p></main>; }`,
      );
      await fs.mkdir(path.join(root, "src", "app", "about"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "about", "page.tsx"),
        `export const dynamic = "force-static";\nexport default function About() { return <main><h1>About</h1></main>; }`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          // A lowercase Link of the app's own sits next to the mirror's Link.
          routeRules: {
            "/about": { headers: { link: '</about.css>; rel="preload"; as="style"' } },
          },
          generateBuildId: () => "production-prerender-markdown-link-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });
      // The page is served as a static file, so it cannot negotiate Accept; the
      // Link header is how agents find its mirror.
      expect(
        await fs
          .stat(path.join(root, ".farm", ".output", "public", "pricing", "index.html"))
          .then(() => true),
      ).toBe(true);

      const serverDir = path.join(root, ".farm", ".output", "server");
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.headers.get("content-type")).toContain("text/html");
          expect(response.headers.get("link")).toBe(
            '</pricing.md>; rel="alternate"; type="text/markdown"',
          );
        },
        "/pricing",
      );
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.headers.get("content-type")).toContain("text/html");
          expect(response.headers.get("link")).toBe(
            '</about.css>; rel="preload"; as="style", </about.md>; rel="alternate"; type="text/markdown"',
          );
        },
        "/about",
      );
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
          expect(await response.text()).toContain("# Pricing");
        },
        "/pricing.md",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps production slot params request-local beneath a basePath", async () => {
    const root = await createProductionFixture();
    const writeRoute = async (name: string, source: string) => {
      const target = path.join(root, "src", "app", name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, source);
    };

    try {
      await writeRoute(
        "layout.tsx",
        `export default function Layout({ children, panel, trail }) {
          return <html><body>{children}<aside>{panel}</aside><nav>{trail}</nav></body></html>;
        }`,
      );
      await writeRoute(
        "items/[id]/page.tsx",
        `export default function Page({ params }) { return <main data-page-id={params.id}>Item</main>; }`,
      );
      await writeRoute(
        "items/layout.tsx",
        `export default function Layout({ children, detail }) { return <section>{children}{detail}</section>; }`,
      );
      // Both entries share a non-root owner. Include and exclude that owner in
      // concurrent requests to exercise the emitted request-local owner cache.
      await writeRoute(
        "items/@detail/[id]/page.tsx",
        `export default async function Detail({ params }) {
          await Promise.resolve();
          return <p data-detail-id={params.id}>Detail</p>;
        }`,
      );
      await writeRoute(
        "items/@detail/default.tsx",
        `export default function Default() { return null; }`,
      );
      await writeRoute(
        "docs/[[...slug]]/page.tsx",
        `export default function Page() { return <main data-docs-page>Docs</main>; }`,
      );
      await writeRoute(
        "@panel/items/[id]/page.tsx",
        `export default async function Panel({ params }) {
          await Promise.resolve();
          return <p data-slot-id={params.id}>Panel</p>;
        }`,
      );
      await writeRoute(
        "@panel/default.tsx",
        `export default function Fallback() { return <p data-slot-fallback>Fallback</p>; }`,
      );
      await writeRoute(
        "@trail/[[...segments]]/page.tsx",
        `export default function Trail({ params }) { return <p data-slot-path={params.segments}>Trail</p>; }`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          basePath: "/workspace",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-slot-request-isolation-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const initial = await response.text();
          expect(initial).toContain("data-slot-fallback");
          expect(initial).toContain('data-slot-path=""');
          const origin = new URL(response.url).origin;
          const cases = [
            { pathname: "/items/first", id: "first", trail: "items/first" },
            { pathname: "/items/second", id: "second", trail: "items/second" },
            { pathname: "/items/a%2Fb", id: "a/b", trail: "items/a/b" },
            { pathname: "/items/a%252Fb", id: "a%2Fb", trail: "items/a%2Fb" },
            { pathname: "/items/%ZZ", id: null, trail: null },
            { pathname: "/items/%E0%A4", id: null, trail: null },
            { pathname: "/docs", id: null, trail: "docs" },
            { pathname: "/docs/a%2Fb/c", id: null, trail: "docs/a/b/c" },
          ];
          // Interleave different fixed/catch-all matches, including repeated
          // requests, so immutable preparation cannot leak mutable params.
          await Promise.all(
            [...cases, ...cases.slice().reverse()].map(async ({ pathname, id, trail }) => {
              const result = await fetch(`${origin}/workspace${pathname}`);
              if (trail === null) {
                // H3 rejects malformed URL encodings before Farm's selector.
                // Preserve that HTTP boundary as well as matcher-level parity.
                expect(result.status, pathname).toBe(400);
                expect(await result.text(), pathname).not.toContain("data-slot-id=");
                return;
              }
              expect(result.status, pathname).toBe(200);
              const html = await result.text();
              expect(html, pathname).toContain(`data-slot-path="${trail}"`);
              if (id === null) {
                expect(html, pathname).toContain("data-docs-page");
                expect(html, pathname).toContain("data-slot-fallback");
                expect(html, pathname).not.toContain("data-slot-id=");
                expect(html, pathname).not.toContain("data-detail-id=");
              } else {
                expect(html, pathname).toContain(`data-page-id="${id}"`);
                expect(html, pathname).toContain(`data-slot-id="${id}"`);
                expect(html, pathname).toContain(`data-detail-id="${id}"`);
                expect(html, pathname).not.toContain("data-slot-fallback");
              }
            }),
          );
          const head = await fetch(`${origin}/workspace/items/first`, { method: "HEAD" });
          expect(head.status).toBe(200);
          expect(await head.text()).toBe("");
        },
        "/workspace",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("runs route middleware for pages beneath the configured basePath", async () => {
    const root = await createProductionFixture();

    try {
      await fs.mkdir(path.join(root, "src", "app", "dashboard"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "dashboard", "page.tsx"),
        `export default function Page() { return <main>dashboard page</main>; }`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "dashboard", "middleware.ts"),
        `export default function middleware(ctx) { ctx.headers.set("x-dashboard-middleware", "ran"); }`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          basePath: "/workspace",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-base-path-middleware-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          expect(await response.text()).toContain("dashboard page");
          expect(response.headers.get("x-dashboard-middleware")).toBe("ran");
        },
        "/workspace/dashboard",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("negotiates Markdown using the post-middleware pathname", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "middleware.ts"),
        `export default function middleware(ctx) {
  if (ctx.pathname === "/to-markdown") {
    ctx.rewrite("/index.md");
    ctx.headers.set("x-mirror-rewrite", "markdown");
  } else if (ctx.pathname === "/from-markdown.md") {
    ctx.rewrite("/");
    ctx.headers.set("x-mirror-rewrite", "html");
  }
}`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "production-markdown-rewrite-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toContain("text/markdown");
          expect(response.headers.get("content-location")).toBe("/index.md");
          expect(response.headers.get("x-mirror-rewrite")).toBe("markdown");
          expect(await response.text()).toContain("prebuilt SSR output: src alias resolved");

          const html = await fetch(new URL("/from-markdown.md", response.url), {
            headers: { accept: "text/html" },
          });
          expect(html.status).toBe(200);
          expect(html.headers.get("content-type")).toContain("text/html");
          expect(html.headers.get("x-mirror-rewrite")).toBe("html");
          expect(await html.text()).toContain('data-prebuilt-ssr="ready"');

          const head = await fetch(response.url, {
            method: "HEAD",
            headers: { accept: "text/html" },
          });
          expect(head.status).toBe(200);
          expect(head.headers.get("content-type")).toContain("text/markdown");
          expect(head.headers.get("x-mirror-rewrite")).toBe("markdown");
          expect(await head.text()).toBe("");
        },
        "/to-markdown",
        { headers: { accept: "text/html" } },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("hydrates client components inside a Markdown page under a hydrating layout", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "layout-mark.tsx"),
        `"use client";\nexport function LayoutMark() { return <span data-layout-mark>layout</span>; }`,
      );
      await fs.writeFile(
        path.join(root, "src", "app", "layout.tsx"),
        `import { LayoutMark } from "./layout-mark";
export default function RootLayout({ children }) {
  return <html><body><LayoutMark />{children}</body></html>;
}`,
      );
      await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "components", "copy-button.tsx"),
        `"use client";
import { useState } from "react";
export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return <button data-copy-island onClick={() => setCopied(true)}>{copied ? "copied" : text}</button>;
}`,
      );
      await fs.writeFile(
        path.join(root, "src", "markdown-components.tsx"),
        `import { CopyButton } from "./components/copy-button";\nexport const components = { CopyButton };`,
      );
      await fs.mkdir(path.join(root, "src", "app", "notes"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "notes", "page.md"),
        `# Notes\n\nSome server-rendered text.\n\n<CopyButton text="copy me" />\n`,
      );
      await fs.mkdir(path.join(root, "src", "app", "notes-mdx"), { recursive: true });
      await fs.copyFile(
        path.join(root, "src", "app", "notes", "page.md"),
        path.join(root, "src", "app", "notes-mdx", "page.mdx"),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          mdx: { components: "./src/markdown-components.tsx" },
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "markdown-islands-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      const clientJavaScript = await readAllClientJavaScript(root);
      expect(clientJavaScript).toContain("data-copy-island");
      // The island loader is keyed by the module the server marker names.
      expect(clientJavaScript).toContain('"/src/components/copy-button.tsx"');
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toContain("Some server-rendered text.");
          expect(html).toContain('data-farm-layout-client="true"');
          expect(html).toMatch(/<f-island[^>]*copy-button/);
          expect(html).toContain("<title>Notes</title>");

          const mdx = await fetch(new URL("/notes-mdx", response.url));
          expect(mdx.status).toBe(200);
          const mdxHtml = await mdx.text();
          expect(mdxHtml).toContain("Some server-rendered text.");
          expect(mdxHtml).toMatch(/<f-island[^>]*copy-button/);
          expect(mdxHtml).toContain("<title>Notes</title>");

          for (const pathname of ["/notes.md", "/notes-mdx.md"]) {
            const raw = await fetch(new URL(pathname, response.url));
            expect(raw.status).toBe(200);
            expect(raw.headers.get("content-type")).toContain("text/markdown");
            expect(await raw.text()).toBe(
              `# Notes\n\nSome server-rendered text.\n\n<CopyButton text="copy me" />\n`,
            );
          }
        },
        "/notes",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("preserves route-rule redirect status and explicit destination queries", async () => {
    const root = await createProductionFixture();

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          routeRules: {
            "/legacy": { redirect: { to: "/current?view=compact", statusCode: 303 } },
            "/moved": { redirect: { to: "/current", permanent: true } },
          },
          generateBuildId: () => "production-route-rule-redirect-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });
      const serverDir = path.join(root, ".farm", ".output", "server");

      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(303);
          expect(response.headers.get("location")).toBe("/current?view=compact");
        },
        "/legacy?view=full&campaign=launch",
        { redirect: "manual" },
      );
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(308);
          expect(response.headers.get("location")).toBe("/current?campaign=launch");
        },
        "/moved?campaign=launch",
        { redirect: "manual" },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("serves the configured OpenAPI reference in production", async () => {
    const root = await createProductionFixture();
    const apiDir = path.join(root, "src", "app", "api", "health");

    try {
      await fs.mkdir(apiDir, { recursive: true });
      await fs.writeFile(
        path.join(apiDir, "route.ts"),
        `export function GET() { return Response.json({ ok: true }); }`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          openapi: {
            enabled: true,
            route: "/docs/reference",
            title: "Production API",
          },
          generateBuildId: () => "production-openapi-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
          expect(response.headers.get("x-content-type-options")).toBe("nosniff");
          const html = await response.text();
          expect(html).toContain("<title>Production API</title>");
          expect(html).toContain('id="api-reference"');
          const encodedSpec = html.match(/data-url="data:application\/json;base64,([^"]+)"/)?.[1];
          expect(encodedSpec).toBeTruthy();
          const spec = JSON.parse(Buffer.from(encodedSpec!, "base64").toString("utf8"));
          expect(spec.paths["/health"].get.operationId).toBe("get_health");
        },
        "/docs/reference?source=production-test",
      );
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          await expect(response.text()).resolves.toBe("");
        },
        "/docs/reference",
        { method: "HEAD" },
      );
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(405);
          expect(response.headers.get("allow")).toBe("GET, HEAD");
        },
        "/docs/reference",
        { method: "POST" },
      );
      // The raw spec is fetchable as JSON at the well-known /openapi.json path.
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
          const spec = await response.json();
          expect(spec.openapi ?? spec.swagger).toBeTruthy();
          expect(spec.paths["/health"].get.operationId).toBe("get_health");
        },
        "/openapi.json",
      );
      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(405);
          expect(response.headers.get("allow")).toBe("GET, HEAD");
        },
        "/openapi.json",
        { method: "POST" },
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

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

      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(200);
          expect(response.headers.get("cache-control")).toBe("no-store");
          expect(await response.json()).toEqual({
            schemaVersion: 1,
            eventType: "production_site_attestation",
            packageName: "@farm.js/core",
            packageVersion: expect.any(String),
            renderer: "react",
            deployTarget: "node",
          });
        },
        "/.well-known/farm-telemetry",
      );
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
      expect(serverJavaScript).not.toContain("production_site_attestation");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it.each([
    { label: "without a plugin runtime", withPlugin: false },
    { label: "alongside a runtime plugin", withPlugin: true },
  ])(
    "sends Farm Infra analytics only when the environment links a project, $label",
    async ({ withPlugin }) => {
      const root = await createProductionFixture();
      const received: { headers: Record<string, string | string[] | undefined>; body: string }[] =
        [];
      const receiver = createHttpServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          received.push({ headers: request.headers, body });
          response.writeHead(202).end();
        });
      });
      await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
      const receiverPort = (receiver.address() as { port: number }).port;
      const key = `fti_${"t".repeat(43)}`;

      try {
        await fs.mkdir(path.join(root, "src", "app", "users", "[id]"), { recursive: true });
        await fs.writeFile(
          path.join(root, "src", "app", "users", "[id]", "page.tsx"),
          `export default function User({ params }) { return <main data-user={params.id}>user</main>; }`,
        );
        // The same plugin in the built config and in the runtime config module.
        const pluginSource = `{
  name: "fixture-runtime",
  runtime: {
    after({ response }) {
      const headers = new Headers(response.headers);
      headers.set("x-fixture-plugin", "ran");
      return new Response(response.body, { status: response.status, headers });
    },
  },
}`;
        const fixturePlugin = definePlugin({
          name: "fixture-runtime",
          runtime: { after: ({ response }) => response },
        });
        if (withPlugin) {
          await fs.writeFile(
            path.join(root, "farm.config.ts"),
            `export default { plugins: [${pluginSource}] };`,
          );
        }
        // No Infra variables at build time: the server reads them when it starts.
        const config = await resolveConfig(
          {
            root,
            srcDir: "src",
            images: { provider: "none" },
            telemetry: false,
            ...(withPlugin ? { plugins: [fixturePlugin] } : {}),
            generateBuildId: () => "infra-analytics-test",
          },
          "production",
        );
        await build(config, { root, preset: "node-server" });
        const serverDir = path.join(root, ".farm", ".output", "server");
        const pathname = "/users/private-customer?secret=private-query";

        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(200);
            await expect(response.text()).resolves.toContain('data-user="private-customer"');
          },
          pathname,
        );
        // The server flushes on shutdown, so an unlinked app has had every chance to send.
        expect(received).toEqual([]);

        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(200);
            expect(response.headers.get("x-fixture-plugin")).toBe(withPlugin ? "ran" : null);
            await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 5_000 });
          },
          pathname,
          { headers: { "user-agent": "Claude-User/1.0", cookie: "session=private-cookie" } },
          { FARMJS_API_KEY: key, FARMJS_API_URL: `http://127.0.0.1:${receiverPort}` },
        );
        expect(received[0]!.headers.authorization).toBe(`Bearer ${key}`);
        expect(received[0]!.body).not.toContain("private");
        expect(JSON.parse(received[0]!.body)).toEqual({
          schemaVersion: 1,
          events: [
            {
              id: expect.any(String),
              requestId: expect.any(String),
              timestamp: expect.any(String),
              kind: "request",
              route: "/users/[id]",
              method: "GET",
              status: 200,
              durationMs: expect.any(Number),
              agent: { family: "anthropic", category: "agent", identity: "self-reported" },
            },
          ],
        });
      } finally {
        await new Promise((resolve) => receiver.close(resolve));
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("records MCP tool calls in an app whose plugins only add routes", async () => {
    const root = await createProductionFixture();
    const received: string[] = [];
    const receiver = createHttpServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        received.push(body);
        response.writeHead(202).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const receiverPort = (receiver.address() as { port: number }).port;
    const events = () => received.flatMap((body) => JSON.parse(body).events);

    try {
      // Like @farm.js/mcp without OAuth: a route and no runtime hooks, so the server has no
      // plugin runtime. The route reports its tool calls the way @farm.js/mcp does, after an
      // await, as a tool callback would.
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `import { definePlugin } from "@farm.js/core";
import { emitFarmEvent } from "@farm.js/core/observability";
const call = (tool, outcome) =>
  emitFarmEvent({ type: "mcp.tool.complete", route: "/api/mcp", server: "fixture", tool, outcome, durationMs: 3 });
export default {
  plugins: [definePlugin({
    name: "fixture-mcp",
    routes: ({ route }) => [
      route.post("/api/mcp", {
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          call("list_users", "success");
          call("remove_user", "error");
          return { ok: true };
        },
      }),
    ],
  })],
};
`,
      );
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig(
        {
          ...userConfig,
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "infra-tool-calls-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          await vi.waitFor(() => expect(events()).toHaveLength(3), { timeout: 5_000 });
        },
        "/api/mcp",
        {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "Claude-User/1.0" },
          body: "{}",
        },
        {
          FARMJS_API_KEY: `fti_${"r".repeat(43)}`,
          FARMJS_API_URL: `http://127.0.0.1:${receiverPort}`,
        },
      );
      const request = events().find(({ kind }) => kind === "request");
      expect(request).toMatchObject({ method: "POST", status: 200 });
      // Each call is tied to the request that carried it.
      expect(
        events()
          .filter(({ kind }) => kind === "mcp.tool")
          .map(({ tool, outcome, requestId, route, agent }) => ({
            tool,
            outcome,
            requestId,
            route,
            agent,
          })),
      ).toEqual(
        ["list_users:success", "remove_user:error"].map((call) => ({
          tool: call.split(":")[0],
          outcome: call.split(":")[1],
          requestId: request.requestId,
          route: request.route,
          agent: request.agent,
        })),
      );
    } finally {
      await new Promise((resolve) => receiver.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("reports built-in endpoints, Markdown mirrors, and docs pages by a route template", async () => {
    const root = await createProductionFixture();
    const received: string[] = [];
    const receiver = createHttpServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        received.push(body);
        response.writeHead(202).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const receiverPort = (receiver.address() as { port: number }).port;
    const requests = () =>
      received
        .flatMap((body) => JSON.parse(body).events)
        .filter(({ kind }) => kind === "request")
        .map(({ method, route, status }) => `${method} ${route} ${status}`);

    try {
      await fs.mkdir(path.join(root, "src", "app", "blog", "[slug]"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "blog", "[slug]", "page.tsx"),
        `export default function Post({ params }) { return <main>post {params.slug}</main>; }`,
      );
      await fs.mkdir(path.join(root, "src", "app", "about"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "about", "page.tsx"),
        `export default function About() { return <main>about</main>; }`,
      );
      await fs.mkdir(path.join(root, "src", "app", "docs", "routing"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "app", "docs", "page.md"), "# Docs\n\nHome.");
      await fs.writeFile(
        path.join(root, "src", "app", "docs", "routing", "page.md"),
        "# Routing\n\nFile routes.",
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          docs: { entry: "/docs", search: false },
          agent: { mcp: true, llmsTxt: { enabled: true, full: false } },
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "infra-route-labels-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          const origin = new URL(response.url).origin;
          const status = async (pathname: string, init?: RequestInit) => {
            const answer = await fetch(origin + pathname, init);
            await answer.arrayBuffer();
            return answer.status;
          };
          const initialize = JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "fixture", version: "1.0.0" },
            },
          });
          expect(
            await status("/mcp", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
              },
              body: initialize,
            }),
          ).toBe(200);
          expect(await status("/mcp")).toBe(405);
          expect(await status("/llms.txt")).toBe(200);
          expect(await status("/blog/private-post.md")).toBe(200);
          expect(await status("/about.md")).toBe(200);
          expect(await status("/.well-known/farmjs.json")).toBe(200);
          expect(await status("/docs/routing")).toBe(200);
          expect(await status("/blog/private-post?secret=private-query")).toBe(200);
          expect(await status("/private-missing")).toBe(404);
          await vi.waitFor(
            () =>
              expect(requests()).toEqual(
                expect.arrayContaining([
                  "GET / 200",
                  "POST /mcp 200",
                  "GET /mcp 405",
                  "GET /llms.txt 200",
                  "GET /blog/[slug].md 200",
                  "GET /about.md 200",
                  "GET /.well-known/farmjs.json 200",
                  "GET /docs/[...slug] 200",
                  "GET /blog/[slug] 200",
                  "GET /[unmatched] 404",
                ]),
              ),
            { timeout: 5_000 },
          );
        },
        "/",
        undefined,
        {
          FARMJS_API_KEY: `fti_${"l".repeat(43)}`,
          FARMJS_API_URL: `http://127.0.0.1:${receiverPort}`,
        },
      );
      // Only the request nothing answered is unmatched, and no label carries the path.
      expect(requests().filter((line) => line.includes("/[unmatched]"))).toEqual([
        "GET /[unmatched] 404",
      ]);
      expect(received.join("")).not.toContain("private");
    } finally {
      await new Promise((resolve) => receiver.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("serves the same public /.well-known/farmjs.json to anyone, signed by Farm Infra or not", async () => {
    const root = await createProductionFixture();
    const key = `fti_${"m".repeat(43)}`;
    // What @farm.js/mcp does when it mounts its endpoint: publish the tools and their schemas.
    // "fixture" is public; "admin" requires authorize.
    const publish = `_publishFarmMCPCatalog(
      { name: "fixture", version: "1.0.0", path: "/api/mcp" },
      [
        { name: "list_users", title: "List users", kind: "standalone", readOnlyHint: true },
        { name: "remove_user", kind: "endpoint", method: "DELETE", path: "/api/users/[id]", destructiveHint: true },
      ],
      {
        public: true,
        schemas: { list_users: { input: { type: "object", properties: { q: { type: "string" } } } } },
        resources: [{ name: "handbook", uri: "docs://handbook" }],
        prompts: [],
      },
    );
    _publishFarmMCPCatalog(
      { name: "admin", version: "1.0.0", path: "/api/admin/mcp" },
      [{ name: "ban_user", kind: "standalone" }],
      { public: false, resources: [{ name: "audit", uri: "admin://audit" }] },
    );`;

    try {
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `import { _publishFarmMCPCatalog } from "@farm.js/core/api/runtime";
import { defineIntegration } from "@farm.js/core";
export default {
  integrations: { errors: defineIntegration({ category: "monitoring", type: "fixture-errors", instance: {} }) },
  plugins: [{ name: "farm:webmcp" }, {
    name: "fixture-mcp",
    routes: ({ route }) => {
      ${publish}
      return [route.post("/api/mcp", { handler: () => Response.json({ ok: true }) })];
    },
  }],
};`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          deploymentId: "manifest-test",
          integrations: {
            errors: defineIntegration({
              category: "monitoring",
              type: "fixture-errors",
              instance: {},
            }),
          },
          plugins: [
            // The webmcp plugin's name turns on reading WebMCP tools from the source.
            definePlugin({ name: "farm:webmcp" }),
            definePlugin({
              name: "fixture-mcp",
              routes: ({ route }) => [
                route.post("/api/mcp", { handler: () => Response.json({ ok: true }) }),
              ],
            }),
          ],
        },
        "production",
      );
      // A browser tool in the app's source, read at build time; nothing imports it.
      await fs.writeFile(
        path.join(root, "src", "lib", "browser-tools.ts"),
        `import { defineWebMCPTool } from "@farm.js/webmcp/client";
export const listTodos = defineWebMCPTool({
  name: "list_todos",
  description: "List the current todos.",
  inputSchema: { type: "object", additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: async () => ({ todos: [] }),
});`,
      );
      await build(config, { root, preset: "node-server" });
      const serverDir = path.join(root, ".farm", ".output", "server");
      // Reading WebMCP tools is build work: the server never loads the parser's native binary.
      await expect(fs.stat(path.join(serverDir, "node_modules", "rolldown"))).rejects.toThrow();
      const linked = { FARMJS_API_KEY: key, FARMJS_API_URL: "http://127.0.0.1:9" };
      const bodies = new Set<string>();

      // Anyone, linked to Farm Infra or not, signed or not: the one public document.
      for (const [env, init] of [
        [undefined, undefined],
        [linked, undefined],
        [linked, { headers: { "farmjs-infra-signature": legacyFarmInfraSignature(key) } }],
      ] as const) {
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
            expect(response.headers.get("cache-control")).toBe(
              "public, max-age=0, must-revalidate",
            );
            expect(response.headers.get("access-control-allow-origin")).toBe("*");
            const manifest = await response.json();
            expect(manifest).toMatchObject({
              schemaVersion: 1,
              app: { basePath: "/", build: "manifest-test" },
              integrations: [{ key: "errors", category: "monitoring", type: "fixture-errors" }],
            });
            expect(manifest.mcp.servers).toEqual([
              expect.objectContaining({
                name: "fixture",
                authorization: "none",
                resources: [{ name: "handbook", uri: "docs://handbook" }],
                tools: [
                  expect.objectContaining({ name: "list_users", source: "defineTool" }),
                  { name: "remove_user", source: "endpoint", destructiveHint: true },
                ],
              }),
              {
                name: "admin",
                version: "1.0.0",
                path: "/api/admin/mcp",
                authorization: "required",
                resources: [],
                prompts: [],
                tools: [],
              },
            ]);
            expect(manifest.webmcp).toEqual({
              enabled: true,
              tools: [
                {
                  name: "list_todos",
                  description: "List the current todos.",
                  readOnlyHint: true,
                  inputSchema: { type: "object", additionalProperties: false },
                  inputSchemaSource: "literal",
                },
              ],
            });
            expect(manifest.plugins).toEqual(
              expect.arrayContaining(["farm:webmcp", "fixture-mcp"]),
            );
            const body = JSON.stringify(manifest);
            for (const hidden of [key, "/api/users/[id]", "ban_user", "admin://audit"]) {
              expect(body).not.toContain(hidden);
            }
            bodies.add(body);
          },
          "/.well-known/farmjs.json",
          init,
          env,
        );
      }
      expect(bodies.size).toBe(1);

      // Farm 0.1.34 served it at /.well-known/farmjs: that path still answers.
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ schemaVersion: 1 });
        },
        "/.well-known/farmjs",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("serves the agent.manifest sections the app chose, from the embedded config", async () => {
    const root = await createProductionFixture();
    const publish = `_publishFarmMCPCatalog(
      { name: "fixture", version: "1.0.0", path: "/api/mcp" },
      [
        { name: "list_users", kind: "standalone", readOnlyHint: true },
        { name: "remove_user", kind: "standalone", destructiveHint: true },
      ],
      { public: true, schemas: { list_users: { input: { type: "object" } } } },
    );
    _publishFarmMCPCatalog({ name: "internal", version: "1.0.0", path: "/api/internal/mcp" }, [
      { name: "ping", kind: "standalone" },
    ], { public: true });`;
    try {
      // The fixture links @farm.js/core; listing it makes it an installed package.
      await fs.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ private: true, type: "module", dependencies: { "@farm.js/core": "*" } }),
      );
      await fs.writeFile(
        path.join(root, "farm.config.ts"),
        `import { _publishFarmMCPCatalog } from "@farm.js/core/api/runtime";
export default {
  plugins: [{
    name: "fixture-mcp",
    routes: ({ route }) => {
      ${publish}
      return [route.post("/api/mcp", { handler: () => Response.json({ ok: true }) })];
    },
  }],
};`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          deploymentId: "sections-test",
          agent: {
            manifest: {
              app: { build: false },
              packages: "names",
              mcp: { schemas: false, hide: ["internal", "fixture/remove_user"] },
              integrations: false,
              plugins: false,
            },
          },
          plugins: [
            definePlugin({
              name: "fixture-mcp",
              routes: ({ route }) => [
                route.post("/api/mcp", { handler: () => Response.json({ ok: true }) }),
              ],
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      const serverDir = path.join(root, ".farm", ".output", "server");
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(200);
          const manifest = await response.json();
          expect(manifest.app).toEqual({
            farm: expect.any(String),
            renderer: "react",
            basePath: "/",
          });
          expect(manifest.packages).toEqual({ "@farm.js/core": null });
          expect(manifest.mcp.servers).toEqual([
            {
              name: "fixture",
              version: "1.0.0",
              path: "/api/mcp",
              authorization: "none",
              resources: [],
              prompts: [],
              tools: [{ name: "list_users", source: "defineTool", readOnlyHint: true }],
            },
          ]);
          expect(manifest).toMatchObject({ integrations: null, plugins: null });
          expect(manifest.agent).not.toBeNull();
          expect(JSON.stringify(manifest)).not.toContain("sections-test");
        },
        "/.well-known/farmjs.json",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("serves no /.well-known/farmjs.json at either path with agent.manifest: false", async () => {
    const root = await createProductionFixture();
    const key = `fti_${"o".repeat(43)}`;
    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          agent: { manifest: false },
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      const serverDir = path.join(root, ".farm", ".output", "server");
      for (const pathname of ["/.well-known/farmjs.json", "/.well-known/farmjs"]) {
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(404);
            expect(response.headers.get("content-type") ?? "").not.toContain("application/json");
          },
          pathname,
          { headers: { "farmjs-infra-signature": legacyFarmInfraSignature(key) } },
          { FARMJS_API_KEY: key, FARMJS_API_URL: "http://127.0.0.1:9" },
        );
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("marks Nitro's prerender worker so built-in analytics ignores build requests", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `export const ssg = true;
export default function Page() {
  return <main data-prerender-marker={String(process.env.FARM_PRERENDER)}>static</main>;
}`,
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          generateBuildId: () => "infra-analytics-prerender-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      // createFarmInfraAnalyticsPlugin returns null whenever this marker is set.
      await expect(
        fs.readFile(path.join(root, ".farm", ".output", "public", "index.html"), "utf8"),
      ).resolves.toContain('data-prerender-marker="1"');
      expect(process.env.FARM_PRERENDER).toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("leaves Farm Infra analytics out of the server when analytics is false", async () => {
    const root = await createProductionFixture();

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          telemetry: false,
          analytics: false,
          generateBuildId: () => "infra-analytics-disabled-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      const serverJavaScript = await readJavaScriptOutput(
        path.join(root, ".farm", ".output", "server"),
      );
      expect(serverJavaScript).not.toContain("farm:infra-analytics");
      expect(serverJavaScript).not.toContain("FARMJS_PROJECT_ID");
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
      const serverLayoutSentinel = `SERVER_LAYOUT_SENTINEL_${Array.from({ length: 16384 }, () => {
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
    const container = ref.current?.closest("f-island");
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
    const container = ref.current?.closest("f-island");
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
      expect(baselineJavaScript).not.toContain("<f-island");
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
          expect(html).toContain('<f-island src="/src/components/counter.tsx"');
          expect(html).toContain('export="default"');
          expect(html).toContain('data-isolated-counter="first"');
          expect(html).toContain('data-isolated-counter="second"');
          expect(html).toContain("data-nested-counter");
          expect(html).toContain(">2</button>");
          expect(html).toContain('data-page-counter="first-page"');
          expect(html.match(/<f-island/g)).toHaveLength(4);
          expect(html).not.toContain('<f-island src="/src/components/child-counter.tsx"');

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
              if (message.type() === "error") {
                if (message.location().url.endsWith("/favicon.ico")) return;
                browserErrors.push(message.text());
              }
            });
            page.on("pageerror", (error) => browserErrors.push(error.message));
            await page.goto(response.url);
            const first = page.locator('[data-isolated-counter="first"]');
            const second = page.locator('[data-isolated-counter="second"]');
            const nested = page.locator("[data-nested-counter]");
            const pageCounter = page.locator('[data-page-counter="first-page"]');
            for (const counter of [first, nested, pageCounter]) {
              await expect
                .poll(() =>
                  counter.evaluate((element) =>
                    element.closest("f-island")?.getAttribute("data-farm-hydrated"),
                  ),
                )
                .toBe("true");
            }
            await first.evaluate((element) => element.setAttribute("data-identity", "retained"));
            await first.click();
            await nested.click();
            await pageCounter.click();

            await expect.poll(() => first.textContent()).toBe("3");
            await expect.poll(() => second.textContent()).toBe("5");
            await expect.poll(() => nested.textContent()).toBe("11");
            await expect.poll(() => first.getAttribute("data-identity")).toBe("retained");
            await expect.poll(() => pageCounter.textContent()).toBe("1");
            await expect
              .poll(() => page.locator('f-island[data-farm-hydrated="true"]').count())
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
              .poll(() => page.locator('f-island[data-farm-hydrated="true"]').count())
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

  it("enforces the measured isolated-root budget across layouts and pages", async () => {
    const root = await createProductionFixture();
    const developmentRoot = await createProductionFixture();

    try {
      await fs.mkdir(path.join(root, "src", "components"), { recursive: true });
      await fs.mkdir(path.join(root, "src", "app", "safe"), { recursive: true });
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
        path.join(root, "src", "app", "layout.tsx"),
        `
import Counter from "../components/counter";

export default function Layout({ children }) {
  return <><header><Counter name="layout-1" /><Counter name="layout-2" /></header>{children}</>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import Counter from "../components/counter";

export default function Page() {
  return <main>${Array.from(
    { length: 3 },
    (_, index) => `<Counter name="overflow-${index + 1}" />`,
  ).join("")}</main>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "safe", "page.tsx"),
        `
import Counter from "../../components/counter";

export default function Page() {
  return <main><Counter name="safe-1" /><Counter name="safe-2" /></main>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(developmentRoot, "index.mjs"),
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
      await fs.cp(path.join(root, "src"), path.join(developmentRoot, "src"), {
        recursive: true,
        force: true,
      });

      const verifyRuntime = async (
        response: Response,
        expected: {
          isolatedRoots: number;
          pageHydrates: boolean;
          counter: string;
          totalCounters: number;
        },
      ) => {
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html.match(/<f-island/g) ?? []).toHaveLength(expected.isolatedRoots);
        expect(html).toMatch(
          new RegExp(
            `id="__farm_page__"[^>]*data-farm-client="${expected.pageHydrates ? "true" : "false"}`,
          ),
        );

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
          const counter = page.locator(`[data-cost-counter="${expected.counter}"]`);
          try {
            await expect
              .poll(() => page.locator('f-island[data-farm-hydrated="true"]').count())
              .toBe(expected.isolatedRoots);
            await counter.click();
            await expect.poll(() => counter.textContent()).toBe(`${expected.counter}:1`);
            await expect
              .poll(() => page.locator("[data-cost-counter]").count())
              .toBe(expected.totalCounters);
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

      const verifyServer = async (response: Response) => {
        const origin = new URL(response.url).origin;
        await verifyRuntime(response, {
          isolatedRoots: 2,
          pageHydrates: true,
          counter: "overflow-2",
          totalCounters: 5,
        });
        await verifyRuntime(await fetch(`${origin}/safe`), {
          isolatedRoots: 4,
          pageHydrates: false,
          counter: "safe-2",
          totalCounters: 4,
        });
      };

      await runProductionRequest(developmentRoot, verifyServer);

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
      expect(clientJavaScript).toContain("__farm_client_boundary_originals__");
      expect(clientJavaScript).toContain("Could not hydrate isolated client boundary");

      await runProductionRequest(path.join(root, ".farm", ".output", "server"), verifyServer);
    } finally {
      await Promise.all(
        [root, developmentRoot].map((fixtureRoot) =>
          fs.rm(fixtureRoot, { recursive: true, force: true }),
        ),
      );
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
              state.__farmObserverUnobserves = 0;
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
                unobserve() {
                  // Retain the target to simulate deliveries queued before cleanup.
                  state.__farmObserverUnobserves++;
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

            const boundary = (strategy: string) => page.locator(`f-island[strategy="${strategy}"]`);
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
              targets: (globalThis as any).__farmObserverUnobserves,
              idle: (globalThis as any).__farmIdleCancellations,
            }));
            expect(cleanup.observers).toBeGreaterThanOrEqual(1);
            expect(cleanup.targets).toBeGreaterThanOrEqual(1);
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
            expect(html).toContain(`strategy="${strategy}"`);
          }
          expect(html.match(/<f-island/g)).toHaveLength(4);
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
    const fixtureResults = await Promise.allSettled([
      createIsolatedParityFixture(),
      createIsolatedParityFixture(),
      createIsolatedParityFixture(),
      createIsolatedParityFixture({ ssg: true }),
    ]);
    const roots = fixtureResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const fixtureFailure = fixtureResults.find((result) => result.status === "rejected");
    if (fixtureFailure?.status === "rejected") {
      await Promise.allSettled(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
      throw fixtureFailure.reason;
    }
    const [developmentRoot, streamingRoot, bufferedRoot, staticRoot] = roots;
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
    const verifyIndependentInitialScheduling = async (
      url: string,
      options: { expectedIsolatedRoots?: number; stableCounterIsInteractive?: boolean } = {},
    ) => {
      const expectedIsolatedRoots = options.expectedIsolatedRoots ?? 3;
      const stableCounterIsInteractive = options.stableCounterIsInteractive ?? true;
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
        try {
          await page.goto(new URL("/fallback", url).href);

          await expect
            .poll(() => page.locator('f-island[data-farm-hydrated="true"]').count())
            .toBe(expectedIsolatedRoots);
          expect(
            await page.locator("#__farm_page__").getAttribute("data-farm-island-hydrated"),
          ).toBeNull();
          if (stableCounterIsInteractive) {
            await page.locator("[data-stable-counter]").click();
            await expect
              .poll(() => page.locator("[data-stable-counter]").textContent())
              .toBe("stable:1");
          }
          await page.locator("[data-fallback-counter]").click();
          await expect
            .poll(() => page.locator("[data-fallback-counter]").textContent())
            .toBe("fallback:1");
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
              .poll(() => page.locator('f-island[data-farm-hydrated="true"]').count())
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

            await fs.writeFile(
              path.join(developmentRoot, "src", "components", "stable-counter.tsx"),
              `export default function StableCounter() { return <output data-stable-counter>server-stable</output>; }`,
            );
            await expect
              .poll(() => page.locator("[data-stable-counter]").textContent(), {
                timeout: 10_000,
              })
              .toBe("server-stable");
            await expect
              .poll(() => page.locator('f-island[data-farm-hydrated="true"]').count())
              .toBe(2);

            await fs.writeFile(
              path.join(developmentRoot, "src", "components", "page-owner.tsx"),
              `import LiveCounter from "./live-counter";
export default function PageOwner() { return <section data-page-owner><LiveCounter name="page" /></section>; }`,
            );
            await fs.writeFile(
              path.join(developmentRoot, "src", "app", "page.tsx"),
              `import PageOwner from "../components/page-owner";
export default function Page() { return <main data-parity-page>Parity page <PageOwner /></main>; }`,
            );
            await expect.poll(() => page.locator("[data-page-owner]").count()).toBe(1);
            await expect
              .poll(() => page.locator('f-island[data-farm-hydrated="true"]').count())
              .toBe(3);
            await page.evaluate(() => {
              (
                window as typeof window & { __farmParityOwnershipDocument?: string }
              ).__farmParityOwnershipDocument = "stale";
            });
            await fs.writeFile(
              path.join(developmentRoot, "src", "components", "page-owner.tsx"),
              `import LiveCounter from "./live-counter";
export const hydrate = true;
export default function PageOwner() { return <section data-page-owner><LiveCounter name="page" /></section>; }`,
            );
            await expect
              .poll(
                () =>
                  page.evaluate(
                    () =>
                      (
                        window as typeof window & {
                          __farmParityOwnershipDocument?: string;
                        }
                      ).__farmParityOwnershipDocument ?? null,
                  ),
                { timeout: 10_000 },
              )
              .toBeNull();
            await expect
              .poll(() => page.locator("#__farm_page__").getAttribute("data-farm-client"))
              .toBe("true");
            await expect
              .poll(() => page.locator('f-island[data-farm-hydrated="true"]').count())
              .toBe(2);
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
        await verifyIndependentInitialScheduling(response.url, {
          expectedIsolatedRoots: 2,
          stableCounterIsInteractive: false,
        });
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
          await verifyIndependentInitialScheduling(response.url);
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
          await verifyIndependentInitialScheduling(response.url);
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

  async function buildWithIncompleteClientAttempts(root: string, incompleteAttempts: number) {
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
    const buildWithIncompleteClient = (async (inlineConfig: any) => {
      if (!inlineConfig.build?.ssr) {
        clientBuildAttempts++;
        if (clientBuildAttempts <= incompleteAttempts) {
          const outputDir = path.resolve(inlineConfig.root, inlineConfig.build.outDir);
          await fs.mkdir(outputDir, { recursive: true });
          await fs.writeFile(path.join(outputDir, "farm-client.js"), "");
          return { output: [] };
        }
      }

      return productionVite.build(inlineConfig);
    }) as FarmProductionViteRuntime["build"];

    const result = build(config, {
      root,
      preset: "node-server",
      productionVite: { ...productionVite, build: buildWithIncompleteClient },
    });
    return { result, attempts: () => clientBuildAttempts };
  }

  it("recovers an incomplete Rolldown client bundle after the parallel SSR build", async () => {
    const root = await createProductionFixture();

    try {
      const { result, attempts } = await buildWithIncompleteClientAttempts(root, 1);
      await result;

      expect(attempts()).toBe(2);
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

  it("fails instead of shipping a client bundle that stays incomplete after the retry", async () => {
    const root = await createProductionFixture();

    try {
      const { result, attempts } = await buildWithIncompleteClientAttempts(root, 2);
      await expect(result).rejects.toThrow(
        "The client bundle was still incomplete after a sequential rebuild",
      );
      expect(attempts()).toBe(2);
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
            {
              source: "/:slug",
              headers: [
                { key: "X-Header-Order", value: "dynamic" },
                { key: "Set-Cookie", value: "shared=1; Path=/" },
              ],
            },
            {
              source: "/about",
              headers: [
                { key: "X-Header-Order", value: "exact" },
                { key: "Set-Cookie", value: "shared=1; Path=/" },
                { key: "set-cookie", value: "about=1; Path=/" },
              ],
            },
            {
              source: "/docs/:parts*",
              headers: [{ key: "X-Header-Order", value: "catch-all" }],
            },
          ],
          generateBuildId: () => "prebuilt-ssr-test",
        },
        "production",
      );
      const nodeEnvBeforeBuild = process.env.NODE_ENV;
      await build(config, { root, preset: "node-server" });
      expect(process.env.NODE_ENV).toBe(nodeEnvBeforeBuild);
      const nitroEntry = await fs.readFile(
        path.join(root, ".farm", "ssr", "nitro-entry.mjs"),
        "utf8",
      );
      expect(nitroEntry).toContain("registerFarmCloseHook()");
      expect(nitroEntry).toContain("from '#nitro/runtime/app'");
      expect(nitroEntry).not.toContain("from 'nitro/app'");
      expect(nitroEntry).not.toContain("from 'nitro/runtime'");

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
        expect(response.headers.has("x-header-order")).toBe(false);
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
          expect(exactResponse.headers.get("x-header-order")).toBe("exact");
          expect(exactResponse.headers.getSetCookie()).toEqual([
            "shared=1; Path=/",
            "about=1; Path=/",
          ]);
          await expect(exactResponse.text()).resolves.toContain("exact production route");
        }

        const dynamicResponse = await fetch(new URL("/contact", response.url));
        expect(dynamicResponse.status).toBe(200);
        expect(dynamicResponse.headers.get("x-header-order")).toBe("dynamic");
        expect(dynamicResponse.headers.getSetCookie()).toEqual(["shared=1; Path=/"]);
        const dynamicHtml = await dynamicResponse.text();
        expect(dynamicHtml).toContain("dynamic production route");
        expect(dynamicHtml).toContain("contact");

        for (const pathname of ["/docs", "/docs/routing/production"]) {
          const catchAllResponse = await fetch(new URL(pathname, response.url));
          expect(catchAllResponse.status).toBe(200);
          expect(catchAllResponse.headers.get("x-header-order")).toBe("catch-all");
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
  // it.for, not it.each: only it.for hands the test context to the callback, so
  // ctx.skip() works where bun is missing or the platform is Windows.
  it.for([
    { preset: "node-server", command: process.execPath },
    { preset: "bun", command: "bun" },
  ])(
    "drains in-flight requests and closes production resources on SIGTERM ($preset)",
    async ({ preset, command }, ctx) => {
      if (isWindows) ctx.skip();
      if (preset === "bun" && !hasBun) ctx.skip();
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
        await build(config, { root, preset });

        const serverDir = path.join(root, ".farm", ".output", "server");
        const port = await getAvailablePort();
        const output: string[] = [];
        const productionServer = spawn(command, [path.join(serverDir, "index.mjs")], {
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

        // An idle server exits right away, still running the shutdown hooks.
        await fs.rm(markerPath);
        const idleServer = spawn(command, [path.join(serverDir, "index.mjs")], {
          cwd: serverDir,
          env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const idleOutput: string[] = [];
        idleServer.stdout.on("data", (chunk) => idleOutput.push(String(chunk)));
        idleServer.stderr.on("data", (chunk) => idleOutput.push(String(chunk)));
        try {
          const ready = await waitForServer(
            `http://127.0.0.1:${port}/health/ready`,
            () => idleOutput.join(""),
            () => idleServer.exitCode !== null,
          );
          await ready.arrayBuffer();
          const exited = new Promise<number | null>((resolve) => idleServer.once("exit", resolve));
          const signalledAt = performance.now();
          idleServer.kill("SIGTERM");
          expect(await exited).toBe(0);
          expect(performance.now() - signalledAt).toBeLessThan(500);
          expect((await fs.readFile(markerPath, "utf8")).trim().split("\n")).toEqual([
            "runtime:ready",
            "runtime:closed:production-server-closed",
            "resource:closed",
          ]);
        } finally {
          if (idleServer.exitCode === null) idleServer.kill("SIGKILL");
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

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
export const POST = QUERY;
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
      for (const method of ["POST", "QUERY"])
        await runProductionRequest(
          path.join(root, ".farm", ".output", "server"),
          async (response) => {
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({
              method,
              body: { filters: ["tools", "seeds"] },
            });
          },
          "/api/structured-search",
          {
            method,
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
        const pprSuspenseDir = path.join(root, "src", "app", "ppr-suspense");
        const failureDir = path.join(root, "src", "app", "failure");
        await fs.mkdir(suspenseDir, { recursive: true });
        await fs.mkdir(pprSuspenseDir, { recursive: true });
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
          path.join(pprSuspenseDir, "content.tsx"),
          `
export default function PPRSuspenseContent() {
  return <p data-ppr-suspense="ready">ppr-suspense-ready</p>;
}
`.trim(),
        );
        await fs.writeFile(
          path.join(pprSuspenseDir, "page.tsx"),
          `
import React, { lazy, Suspense } from "react";

export const ppr = true;

const PPRSuspenseContent = lazy(() =>
  new Promise((resolve) => {
    setTimeout(() => resolve(import("./content")), 100);
  }),
);

export default function PPRSuspensePage() {
  return (
    <main>
      <Suspense fallback={<p>ppr-suspense-fallback</p>}>
        <PPRSuspenseContent />
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

export const ProgrammaticGuardedRoute = createRoute("/programmatic-guarded/[id]", {
  guard() {
    notFound();
  },
  generateMetadata({ params }) {
    return {
      title: "guarded-private-title-" + params.id,
      description: "guarded-private-description",
      openGraph: { title: "guarded-private-og" },
    };
  },
  notFound: ProgrammaticNotFound,
  component: ProgrammaticPage,
});

export const ProgrammaticGuardErrorRoute = createRoute("/programmatic-guard-error", {
  guard() {
    throw new Error("guard-refused");
  },
  generateMetadata() {
    return { title: "guard-error-private-title" };
  },
  error: ProgrammaticError,
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
  ProgrammaticGuardedRoute,
  ProgrammaticGuardErrorRoute,
  ProgrammaticRedirectRoute,
]);
`.trim(),
        );

        const config = await resolveConfig(
          {
            root,
            srcDir: "src",
            images: { provider: "none" },
            experimental: { ppr: true },
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
            expect(response.headers.get("x-farm-ppr")).toBe("bypass");
            await expect(response.text()).resolves.toContain("ppr-suspense-ready");
          },
          "/ppr-suspense",
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
            expect(response.status).toBe(404);
            const html = await response.text();
            expect(html).toContain("programmatic-not-found");
            expect(html).not.toContain("guarded-private");
          },
          "/programmatic-guarded/42",
        );
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(500);
            const html = await response.text();
            expect(html).toContain("guard-refused");
            expect(html).not.toContain("guard-error-private-title");
          },
          "/programmatic-guard-error",
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

  it.each([false, true])(
    "keeps plugin-replaced requests current during production rendering (headers: %s)",
    async (withHeaders) => {
      const root = await createProductionFixture();
      const runtimePlugin = `
{
  name: "production-runtime-request-context",
  runtime: {
    before({ request }) {
      const headers = new Headers(request.headers);
      headers.set("x-plugin-request", "transformed");
      const url = new URL(request.url);
      url.pathname = "/base/target";
      return new Request(new Request(url, request), { headers });
    },
  },
}`;

      try {
        await fs.writeFile(
          path.join(root, "farm.config.mjs"),
          `export default { plugins: [${runtimePlugin}] };`,
        );
        await fs.mkdir(path.join(root, "src", "app", "target"));
        await fs.writeFile(
          path.join(root, "src", "app", "target", "page.tsx"),
          `
import { getCurrentRequest } from "@farm.js/core/request";

export default function Page() {
  return <main data-plugin-request={getCurrentRequest().headers.get("x-plugin-request")} data-plugin-url={getCurrentRequest().url}>
    <link rel="preload" as="image" href="/first.webp" />
    <link rel="preload" as="image" href="/second.webp" />
    plugin request context
  </main>;
}
`.trim(),
        );
        const config = await resolveConfig(
          {
            root,
            srcDir: "src",
            basePath: "/base",
            images: { provider: "none" },
            telemetry: false,
            headers: () =>
              withHeaders
                ? [
                    { source: "/incoming", headers: [{ key: "x-response-path", value: "stale" }] },
                    {
                      source: "/target",
                      headers: [
                        { key: "x-response-path", value: "current" },
                        { key: "Set-Cookie", value: "first=1; Path=/" },
                        { key: "Set-Cookie", value: "second=2; Path=/" },
                      ],
                    },
                  ]
                : [],
            generateBuildId: () => "production-runtime-request-context-test",
            plugins: [
              definePlugin({
                name: "production-runtime-request-context",
                runtime: {
                  before({ request }) {
                    const headers = new Headers(request.headers);
                    headers.set("x-plugin-request", "transformed");
                    const url = new URL(request.url);
                    url.pathname = "/base/target";
                    return new Request(new Request(url, request), { headers });
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
            expect(html.match(/<main[^>]*>/)?.[0]).toContain("/base/target?q=one&amp;q=two");
            expect(html).toContain('href="/first.webp"');
            expect(html).not.toContain('href="/second.webp"');
            expect(response.headers.get("x-response-path")).toBe(withHeaders ? "current" : null);
            if (withHeaders)
              expect(response.headers.getSetCookie()).toEqual([
                "first=1; Path=/",
                "second=2; Path=/",
              ]);
          },
          "/base/incoming?q=one&q=two",
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

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

  it("bundles React DOM's edge server build for the Cloudflare Pages worker", async () => {
    const root = await createProductionFixture();

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "react-edge-server-build-test",
          deploy: { target: "cloudflare" },
        },
        "production",
      );

      await build(config, { root, preset: "cloudflare-pages" });

      const workerOutput = await readJavaScriptOutput(
        path.join(root, config.deploy.outputDir, "_worker.js"),
        [".js", ".mjs"],
      );
      expect(workerOutput).toContain("renderToReadableStream");
      // Only React DOM's Node server build exports these.
      expect(workerOutput).not.toContain("prerenderToNodeStream");
      expect(workerOutput).not.toContain("resumeToPipeableStream");
      // React 19's browser server build creates a MessageChannel at module
      // load, which fails in Workers on older compatibility dates. The edge
      // build does not.
      expect(workerOutput).not.toContain("MessageChannel");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("bundles React into the Cloudflare module worker", async () => {
    const root = await createProductionFixture();

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "react-cloudflare-module-test",
          deploy: { target: "cloudflare", preset: "cloudflare-module" },
        },
        "production",
      );

      await build(config, { root, preset: "cloudflare-module" });

      // A Worker has no node_modules, so a bare React import fails at startup
      // with `No such module "react"`.
      const serverOutput = await readJavaScriptOutput(
        path.join(root, config.deploy.outputDir, "server"),
      );
      expect(serverOutput).toContain("renderToReadableStream");
      expect(serverOutput).not.toMatch(/\bfrom\s*["']react(?:-dom(?:\/server)?)?["']/);
      expect(serverOutput).not.toMatch(/\bimport\s*\(?\s*["']react(?:-dom(?:\/server)?)?["']/);
      // React picks its development or production build from NODE_ENV at
      // runtime unless the bundler replaces the check; the worker ships only
      // production. This warning exists only in React's development builds.
      expect(serverOutput).not.toContain("Each child in a list should have a unique");
      expect(serverOutput).not.toMatch(/process\.env\.NODE_ENV|\.env\.NODE_ENV\s*===/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects @farm.js/core/og in a client component at build time", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "app", "share-button.tsx"),
        `
"use client";

import { ImageResponse } from "@farm.js/core/og";

export default function ShareButton() {
  return <button onClick={() => new ImageResponse(<div />)}>share</button>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "page.tsx"),
        `
import ShareButton from "./share-button";

export default function Page() {
  return <main><ShareButton /></main>;
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "og-image-response-client-test",
        },
        "production",
      );

      await expect(build(config, { root, preset: "node-server" })).rejects.toThrow(
        "@farm.js/core/og is server-only and cannot be imported into client code",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("serves a React.lazy opengraph-image as a PNG from a built universal node-server", async () => {
    const root = await createProductionFixture();

    try {
      await fs.writeFile(
        path.join(root, "src", "lib", "lazy-og-target.tsx"),
        `
export default function LazyLabel() {
  return <span className="text-4xl text-white">Lazy OG</span>;
}
`.trim(),
      );
      await fs.writeFile(
        path.join(root, "src", "app", "opengraph-image.tsx"),
        `
import { lazy } from "react";

const LazyLabel = lazy(() => import("../lib/lazy-og-target"));

export const alt = "Lazy universal metadata image";

export default function OpenGraphImage() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-black text-white">
      <LazyLabel />
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
          generateBuildId: () => "metadata-image-lazy-universal-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });
      await expect(
        fs.stat(
          path.join(
            root,
            ".farm",
            ".output",
            "server",
            "node_modules",
            "@vercel",
            "og",
            "package.json",
          ),
        ),
      ).resolves.toBeTruthy();

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (homeResponse) => {
          expect(homeResponse.status).toBe(200);
          const og = await fetch(`${new URL(homeResponse.url).origin}/opengraph-image`);
          expect(og.status).toBe(200);
          expect(og.headers.get("content-type")).toBe("image/png");
          const bytes = Buffer.from(await og.arrayBuffer());
          expect(bytes.subarray(0, 8)).toEqual(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          );
          expect(bytes.length).toBeGreaterThan(0);
        },
        "/",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it.each(["node-server", "bun"])(
    "leaves @vercel/og out of %s output when the app renders no metadata image",
    async (preset) => {
      const root = await createProductionFixture();

      try {
        const config = await resolveConfig(
          {
            root,
            srcDir: "src",
            images: { provider: "none" },
            // A runtime plugin pulls in core's shared server runtime, which
            // holds the lazy @vercel/og import for JSX metadata images.
            plugins: [definePlugin({ name: "test:runtime-before", runtime: { before() {} } })],
            generateBuildId: () => `no-metadata-image-${preset}-test`,
          },
          "production",
        );

        await build(config, { root, preset });

        const serverDir = path.join(root, ".farm", ".output", "server");
        await expect(
          fs.stat(path.join(serverDir, "node_modules", "@vercel", "og")),
        ).rejects.toThrow(/ENOENT/);
        const serverFiles = await fs.readdir(serverDir, { recursive: true });
        for (const file of serverFiles) {
          if (!/\.m?js$/.test(file)) continue;
          expect(await fs.readFile(path.join(serverDir, file), "utf8"), file).not.toMatch(
            /["']@vercel\/og["']/,
          );
        }
        if (preset === "node-server") {
          await runProductionRequest(serverDir, async (response) => {
            expect(response.status).toBe(200);
            expect(await response.text()).toContain("prebuilt SSR output");
          });
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it.each([{ docs: false }, { docs: true }])(
    "keeps the dev pipeline out of a runtime plugin app's server output (%j)",
    async ({ docs }) => {
      const root = await createProductionFixture();

      try {
        // The app's own config imports the plugin API, as a real app does. The
        // server bundles it, so whatever shares a chunk with definePlugin and
        // PluginManager ships too.
        await fs.writeFile(
          path.join(root, "farm.config.ts"),
          `import { definePlugin } from "@farm.js/core/plugin";

export default {
  plugins: [
    definePlugin({
      name: "test:stamp",
      runtime: {
        after({ response }) {
          const headers = new Headers(response.headers);
          headers.set("x-test-plugin", "ran");
          return new Response(response.body, { status: response.status, headers });
        },
      },
    }),
  ],
};
`,
        );
        if (docs) {
          await fs.mkdir(path.join(root, "src", "app", "docs"), { recursive: true });
          await fs.writeFile(
            path.join(root, "src", "app", "docs", "page.mdx"),
            `# Plugin app docs\n\nServer-rendered documentation content.`,
          );
        }
        const userConfig = await loadConfig(root, undefined, "production");
        const config = await resolveConfig(
          {
            ...userConfig,
            root,
            srcDir: "src",
            images: { provider: "none" },
            ...(docs ? { docs: { entry: "/docs", search: false } } : {}),
            generateBuildId: () => `plugin-server-output-${docs}-test`,
          },
          "production",
        );

        await build(config, { root, preset: "node-server" });

        const serverDir = path.join(root, ".farm", ".output", "server");
        let serverCode = "";
        for (const file of await fs.readdir(serverDir, { recursive: true })) {
          if (/\.m?js$/.test(file))
            serverCode += await fs.readFile(path.join(serverDir, file), "utf8");
        }
        // The Vite plugin and dev pipeline never run in a built server.
        expect(serverCode).not.toContain("farm:server-only-entries");
        expect(serverCode).not.toContain("@tailwindcss/vite");
        // The MDX compiler ships only with the docs runtime that uses it.
        if (docs) expect(serverCode).toContain("mdxjsEsm");
        else expect(serverCode).not.toContain("mdxjsEsm");

        await runProductionRequest(serverDir, async (response) => {
          expect(response.status).toBe(200);
          expect(response.headers.get("x-test-plugin")).toBe("ran");
          expect(await response.text()).toContain("prebuilt SSR output");

          // Markdown mirrors are on by default and still work.
          const markdown = await fetch(new URL("/index.md", response.url));
          expect(markdown.status).toBe(200);
          expect(markdown.headers.get("content-type")).toContain("text/markdown");
          expect(await markdown.text()).toContain("prebuilt SSR output");

          if (docs) {
            const page = await fetch(new URL("/docs", response.url));
            expect(page.status).toBe(200);
            expect(page.headers.get("x-test-plugin")).toBe("ran");
            expect(await page.text()).toContain("Plugin app docs");
          }
        });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it("serves a @vercel/og ImageResponse from an API route on a built node-server", async () => {
    const root = await createProductionFixture();

    try {
      // No metadata image route: the API route alone must pull in the image runtime.
      await fs.mkdir(path.join(root, "src", "app", "api", "card"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "api", "card", "route.tsx"),
        `
import { ImageResponse } from "@vercel/og";

export function GET(request) {
  const title = new URL(request.url).searchParams.get("title") ?? "Farm.js";
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: "#09090b", color: "white", fontSize: 48 }}>
      {title}
    </div>,
    { width: 600, height: 315, headers: { "cache-control": "public, max-age=60" } },
  );
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "vercel-og-api-route-node-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("image/png");
          expect(response.headers.get("cache-control")).toBe("public, max-age=60");
          const bytes = Buffer.from(await response.arrayBuffer());
          expect(imageSize(bytes)).toMatchObject({ width: 600, height: 315, type: "png" });
        },
        "/api/card?title=Shared",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("serves an @farm.js/core/og ImageResponse from an API route on a built node-server", async () => {
    const root = await createProductionFixture();

    try {
      // The import reaches @vercel/og through core's bundled og entry, not the app.
      await fs.mkdir(path.join(root, "src", "app", "api", "card"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "api", "card", "route.tsx"),
        `
import { ImageResponse } from "@farm.js/core/og";

export function GET() {
  return new ImageResponse(<div style={{ display: "flex" }}>core og route</div>, {
    width: 600,
    height: 315,
  });
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "core-og-api-route-node-test",
        },
        "production",
      );

      await build(config, { root, preset: "node-server" });

      await runProductionRequest(
        path.join(root, ".farm", ".output", "server"),
        async (response) => {
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("image/png");
          const bytes = Buffer.from(await response.arrayBuffer());
          expect(imageSize(bytes)).toMatchObject({ width: 600, height: 315, type: "png" });
        },
        "/api/card",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("keeps a @vercel/og API route import bundled in Cloudflare worker output", async () => {
    const root = await createProductionFixture();

    try {
      // Node presets keep @vercel/og external; a Worker has no node_modules to load it from.
      await fs.mkdir(path.join(root, "src", "app", "api", "card"), { recursive: true });
      await fs.writeFile(
        path.join(root, "src", "app", "api", "card", "route.tsx"),
        `
import { ImageResponse } from "@vercel/og";

export function GET() {
  return new ImageResponse(<div style={{ display: "flex" }}>Cloudflare og route</div>, {
    width: 600,
    height: 315,
  });
}
`.trim(),
      );
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "vercel-og-api-route-cloudflare-test",
          deploy: { target: "cloudflare", preset: "cloudflare-module" },
        },
        "production",
      );

      await build(config, { root, preset: "cloudflare-module" });

      const serverOutput = await readJavaScriptOutput(
        path.join(root, config.deploy.outputDir, "server"),
      );
      expect(serverOutput).toContain("Cloudflare og route");
      expect(serverOutput).not.toContain(".wasm?module");
      expect(serverOutput).not.toMatch(/\bfrom\s*["']@vercel\/og["']/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("titles the not-found page from its own and the root layout's metadata", async () => {
    // Both document shapes: a layout that renders <html> itself, and one that doesn't.
    for (const layout of [
      "export default function Layout({ children }) { return <html><head><title>Hard-coded</title></head><body>{children}</body></html>; }",
      'export default function Layout({ children }) { return <div id="app">{children}</div>; }',
    ]) {
      const root = await createProductionFixture();
      try {
        await fs.writeFile(
          path.join(root, "src", "app", "layout.tsx"),
          'export const metadata = { title: { template: "%s | Acme", default: "Acme" }, description: "Acme app" };\n' +
            layout,
        );
        await fs.writeFile(
          path.join(root, "src", "app", "not-found.tsx"),
          'export const metadata = { title: "Page not found" };\n' +
            "export default function NotFound() { return <main>custom not found</main>; }",
        );
        const config = await resolveConfig(
          { root, srcDir: "src", images: { provider: "none" }, telemetry: false },
          "production",
        );
        await build(config, { root, preset: "node-server" });
        await runProductionRequest(
          path.join(root, ".farm", ".output", "server"),
          async (response) => {
            expect(response.status).toBe(404);
            const html = await response.text();
            expect(html).toContain("custom not found");
            expect(html.match(/<title>[^<]*<\/title>/g)).toEqual([
              "<title>Page not found | Acme</title>",
            ]);
            expect(html).toContain('<meta name="description" content="Acme app"');
          },
          "/missing",
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  }, 240_000);

  it("answers redirect() and notFound() from pages, streams and middleware", async () => {
    const root = await createProductionFixture();
    const write = async (relativePath: string, source: string) => {
      const filePath = path.join(root, "src", "app", relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, source.trim());
    };
    const navigation = 'import { notFound, redirect } from "@farm.js/core/navigation";';
    const wait = "await new Promise((resolve) => setTimeout(resolve, 50));";

    try {
      // A fragment layout and a root loading boundary: pages stream behind Suspense.
      await write(
        "layout.tsx",
        "export default function Layout({ children }) { return <>{children}</>; }",
      );
      await write("loading.tsx", "export default function Loading() { return <p>loading</p>; }");
      await write(
        "not-found.tsx",
        "export default function NotFound({ pathname }) { return <main>custom not found: {pathname}</main>; }",
      );
      await write(
        "sync-missing/page.tsx",
        `${navigation}\nexport default function Page() { notFound(); }`,
      );
      await write(
        "sync-redirect/page.tsx",
        `${navigation}\nexport default function Page() { redirect("/"); }`,
      );
      // Production awaits an async page before rendering, so its notFound() is
      // early. A nested async component behind its own boundary is late.
      await write(
        "async-missing/page.tsx",
        `${navigation}\nexport default async function Page() { ${wait} notFound(); }`,
      );
      for (const [name, call] of [
        ["late-missing", "notFound()"],
        ["late-redirect", 'redirect("/")'],
      ]) {
        await write(
          `${name}/page.tsx`,
          `import { Suspense } from "react";\n${navigation}\n` +
            `async function Late() { ${wait} ${call}; }\n` +
            "export default function Page() { return <Suspense fallback={<p>loading</p>}><Late /></Suspense>; }",
        );
      }
      for (const [name, call] of [
        ["middleware-missing", "notFound()"],
        ["middleware-redirect", 'redirect("/")'],
      ]) {
        await write(
          `${name}/middleware.ts`,
          `${navigation}\nexport function middleware() { ${call}; }`,
        );
        await write(
          `${name}/page.tsx`,
          "export default function Page() { return <main>should not render</main>; }",
        );
      }
      // A page that hydrates ships its root-entry notFound import to the browser.
      await write(
        "hydrated/counter.tsx",
        '"use client";\nexport function Counter() { return <button>count</button>; }',
      );
      await write(
        "hydrated/page.tsx",
        'import { notFound } from "@farm.js/core";\nimport { Counter } from "./counter";\n' +
          "export default function Page({ params }) { if (params.missing) notFound(); return <Counter />; }",
      );

      const config = await resolveConfig(
        { root, srcDir: "src", images: { provider: "none" }, telemetry: false },
        "production",
      );
      await build(config, { root, preset: "node-server" });
      const serverDir = path.join(root, ".farm", ".output", "server");
      const manual: RequestInit = { redirect: "manual" };

      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(404);
          expect(await response.text()).toMatch(/custom not found: (<!-- -->)?\/sync-missing/);
        },
        "/sync-missing",
      );

      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(307);
          expect(response.headers.get("location")).toBe("/");
        },
        "/sync-redirect",
        manual,
      );

      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(404);
          expect(await response.text()).toMatch(/custom not found: (<!-- -->)?\/async-missing/);
        },
        "/async-missing",
      );

      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(404);
          const html = await response.text();
          expect(html).toContain("custom not found");
          expect(html).not.toContain("should not render");
        },
        "/middleware-missing",
      );

      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(307);
          expect(response.headers.get("location")).toBe("/");
        },
        "/middleware-redirect",
        manual,
      );

      // After the 200 shell, the document recovers in the browser.
      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(200);
          const html = await response.text();
          expect(html).toMatch(
            /<template id="__farm_late_not_found__"><main>custom not found: (<!-- -->)?\/late-missing<\/main><\/template>/,
          );
          expect(html).toContain('m.content="noindex"');
        },
        "/late-missing",
      );

      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(200);
          expect(await response.text()).toContain('window.location.replace("/")');
        },
        "/late-redirect",
        manual,
      );

      await runProductionRequest(
        serverDir,
        async (response) => {
          expect(response.status).toBe(200);
          expect(await response.text()).toContain("<button>count</button>");
        },
        "/hydrated",
      );
      // The browser bundle resolved notFound from the root entry.
      expect(await readAllClientJavaScript(root)).toContain("FARM_NOT_FOUND");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
  // Programmatic routes load through a virtual id that ends in the route path
  // (`routes.tsx?farm-route=api:%2Ffeed.xml`). A path ending in a file extension
  // used to make the production transform read the id as an .xml or .json file.
  it.each(["rolldown"] as const)(
    "builds programmatic routes whose path ends in a file extension with %s",
    async (builder) => {
      const root = await createProductionFixture();

      try {
        await fs.writeFile(
          path.join(root, "src", "routes.tsx"),
          `
import { defineRoutes } from "@farm.js/core";

function Guide() {
  return <main data-dotted-page="true">guide v2</main>;
}

export default defineRoutes(({ api, page }) => [
  api("/feed.xml", {
    GET: () =>
      new Response("<rss><channel><title>feed</title></channel></rss>", {
        headers: { "content-type": "application/rss+xml" },
      }),
  }),
  api("/data.json", { GET: () => Response.json({ ok: true }) }),
  page("/guide.v2", { component: Guide }),
]);
`.trim(),
        );

        const config = await resolveConfig(
          {
            root,
            srcDir: "src",
            images: { provider: "none" },
            generateBuildId: () => `dotted-programmatic-routes-${builder}`,
          },
          "production",
        );
        await build(config, {
          root,
          preset: "node-server",
          productionVite: await loadFarmProductionVite(),
        });

        const serverDir = path.join(root, ".farm", ".output", "server");
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toContain("application/rss+xml");
            await expect(response.text()).resolves.toContain("<title>feed</title>");
          },
          "/feed.xml",
        );
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ ok: true });
          },
          "/data.json",
        );
        await runProductionRequest(
          serverDir,
          async (response) => {
            expect(response.status).toBe(200);
            await expect(response.text()).resolves.toContain('data-dotted-page="true"');
          },
          "/guide.v2",
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
