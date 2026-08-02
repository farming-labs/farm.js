// @vitest-environment node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { build, createServer, type Plugin, type Rollup } from "vite";
import { describe, expect, it, vi } from "vitest";
import { farmFontImportsPlugin, mergeFarmFontCss, renderFarmFontDevHead } from "../font-vite";
import { appendFarmLinkHeader } from "../nitro/production-runtime";
import { farmPlugin } from "../vite";

function fontRuntimeStub(): Plugin {
  return {
    name: "font-runtime-stub",
    enforce: "pre",
    resolveId(id) {
      return id === "@farm.js/core/font" ? "\0font-runtime-stub" : null;
    },
    load(id) {
      if (id !== "\0font-runtime-stub") return null;
      return "export function localFont(){}; export function remoteFont(){};";
    },
  };
}

async function buildFixture(root: string): Promise<Rollup.RollupOutput> {
  const result = await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [fontRuntimeStub(), farmPlugin({ root })],
    build: {
      write: false,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: path.join(root, "entry.ts"),
        output: { entryFileNames: "entry.js" },
      },
    },
  });
  if (Array.isArray(result)) throw new Error("Expected one Vite build output");
  return result;
}

describe("Farm font compiler", () => {
  it("serves generated CSS and font bytes during development", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "farm-font-dev-"));
    const root = await fs.realpath(temporaryRoot);
    await fs.writeFile(path.join(root, "demo.woff2"), Buffer.from("development-font"));
    await fs.writeFile(
      path.join(root, "entry.ts"),
      `import { localFont } from "@farm.js/core/font";
export const demo = localFont({ src: "./demo.woff2", family: "Dev Demo" });`,
    );
    const vite = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [fontRuntimeStub(), farmFontImportsPlugin({ root, basePath: "/docs" })],
      server: { middlewareMode: true },
    });
    const http = createHttpServer(vite.middlewares);

    try {
      const transformed = await vite.transformRequest("/entry.ts");
      expect(transformed?.code).toContain("farm-font-");
      expect(transformed?.code).not.toContain("font-runtime-stub");
      expect(transformed?.code).not.toContain("@farm.js/core/font");
      expect(transformed?.code).toContain("font-css");
      const head = renderFarmFontDevHead(root);
      expect(head).toContain('<link rel="preload"');
      expect(head).toContain('href="/docs/@farm/font/');
      expect(head).toContain('<link rel="stylesheet" href="/@farm/fonts.css">');

      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      const address = http.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const origin = `http://127.0.0.1:${address.port}`;
      const css = await fetch(`${origin}/@farm/fonts.css`).then((response) => response.text());
      const fontPath = css.match(/url\("([^"]+)"\)/)?.[1];

      expect(css).toContain('font-family: "Dev Demo"');
      expect(fontPath).toMatch(/^\/docs\/@farm\/font\/[a-f0-9]{12}\.woff2$/);
      const bytes = await fetch(`${origin}${fontPath}`).then((response) => response.text());
      expect(bytes).toBe("development-font");
    } finally {
      if (http.listening) {
        await new Promise<void>((resolve, reject) =>
          http.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await vite.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("serves publicDir fonts from their Vite URL in base-path development", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "farm-font-public-dev-"));
    const root = await fs.realpath(temporaryRoot);
    await fs.mkdir(path.join(root, "public", "fonts"), { recursive: true });
    await fs.writeFile(
      path.join(root, "public", "fonts", "public.woff2"),
      Buffer.from("public-development-font"),
    );
    await fs.writeFile(
      path.join(root, "entry.ts"),
      `import { localFont } from "@farm.js/core/font";
export const demo = localFont({ src: "/fonts/public.woff2", family: "Public Dev" });`,
    );
    const vite = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [fontRuntimeStub(), farmFontImportsPlugin({ root, basePath: "/docs" })],
      server: { middlewareMode: true },
    });
    const http = createHttpServer(vite.middlewares);

    try {
      await vite.transformRequest("/entry.ts");
      const head = renderFarmFontDevHead(root);
      expect(head).toContain('href="/fonts/public.woff2"');
      expect(head).not.toContain('href="/docs/fonts/public.woff2"');

      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      const address = http.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const origin = `http://127.0.0.1:${address.port}`;
      const css = await fetch(`${origin}/@farm/fonts.css`).then((response) => response.text());

      expect(css).toContain('url("/fonts/public.woff2")');
      await expect(
        fetch(`${origin}/fonts/public.woff2`).then((response) => response.text()),
      ).resolves.toBe("public-development-font");
    } finally {
      if (http.listening) {
        await new Promise<void>((resolve, reject) =>
          http.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await vite.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("turns a local font call into static metadata, CSS, and a hashed asset", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-font-vite-"));
    try {
      const packageRoot = path.join(root, "node_modules", "demo-font");
      await fs.mkdir(path.join(packageRoot, "dist"), { recursive: true });
      await fs.writeFile(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: "demo-font", exports: { ".": "./index.js" } }),
      );
      await fs.writeFile(path.join(packageRoot, "index.js"), "export default {};\n");
      await fs.writeFile(
        path.join(packageRoot, "dist", "demo.woff2"),
        Buffer.from("test-font-binary"),
      );
      await fs.writeFile(
        path.join(root, "entry.ts"),
        `import { localFont } from "@farm.js/core/font";
import { farmFontPreloadHeader } from "virtual:farm-font-runtime";
export const demo = localFont({
  src: "demo-font/dist/demo.woff2",
  family: "Demo Sans",
  weight: "100 900",
  variable: "--font-demo",
  fallback: ["system-ui", "sans-serif"],
});
console.log(demo, farmFontPreloadHeader);`,
      );

      const result = await buildFixture(root);
      const entry = result.output.find(
        (output): output is Rollup.OutputChunk => output.type === "chunk" && output.isEntry,
      );
      const css = result.output
        .filter((output): output is Rollup.OutputAsset => output.type === "asset")
        .filter((output) => output.fileName.endsWith(".css"))
        .map((output) => String(output.source))
        .join("\n");
      const fontAsset = result.output.find(
        (output): output is Rollup.OutputAsset =>
          output.type === "asset" && output.fileName.startsWith("assets/fonts/"),
      );

      expect(entry?.code).toMatch(/className:\s*["']farm-font-/);
      expect(entry?.code).toMatch(/variable:\s*["']farm-font-variable-/);
      expect(entry?.code).toMatch(/preloads:\s*\[\{\s*href:\s*["']\/assets\/fonts\/demo-/);
      expect(entry?.code).not.toContain("localFont({");
      expect(entry?.code).not.toContain("__FARM_FONT_PRELOAD_HEADER__");
      expect(entry?.code).toContain("%3C%2Fassets%2Ffonts%2Fdemo-");
      expect(css).toContain("@font-face");
      expect(css).toContain('font-family: "Demo Sans"');
      expect(css).toContain("font-display: swap");
      expect(css).toContain("--font-demo:");
      expect(fontAsset?.fileName).toMatch(/^assets\/fonts\/demo-h[a-f0-9]{12}\.woff2$/);
      expect(Buffer.from(fontAsset?.source || []).toString()).toBe("test-font-binary");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects loader bindings that would remain after their import is compiled away", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-font-binding-"));
    try {
      await fs.writeFile(path.join(root, "demo.woff2"), Buffer.from("binding-font"));
      await fs.writeFile(
        path.join(root, "entry.ts"),
        `import { localFont } from "@farm.js/core/font";
export const demo = localFont({ src: "./demo.woff2", family: "Binding Demo" });
console.log(localFont, demo);`,
      );

      await expect(buildFixture(root)).rejects.toThrow(
        "localFont can only be referenced by statically compiled font declarations",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses a font from publicDir without emitting a duplicate asset", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-font-public-"));
    try {
      await fs.mkdir(path.join(root, "static", "fonts"), { recursive: true });
      await fs.writeFile(
        path.join(root, "static", "fonts", "public.woff2"),
        Buffer.from("public-font-binary"),
      );
      await fs.writeFile(
        path.join(root, "entry.ts"),
        `import { localFont } from "@farm.js/core/font";
import { farmFontPreloadHeader } from "virtual:farm-font-runtime";
export const demo = localFont({ src: "/fonts/public.woff2", family: "Public Sans" });
console.log(demo, farmFontPreloadHeader);`,
      );

      const result = await build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [fontRuntimeStub(), farmPlugin({ root, basePath: "/docs", publicDir: "static" })],
        build: {
          write: false,
          rollupOptions: {
            input: path.join(root, "entry.ts"),
            output: { entryFileNames: "entry.js" },
          },
        },
      });
      if (Array.isArray(result)) throw new Error("Expected one Vite build output");
      const entry = result.output.find(
        (output): output is Rollup.OutputChunk => output.type === "chunk" && output.isEntry,
      );
      const assets = result.output.filter(
        (output): output is Rollup.OutputAsset => output.type === "asset",
      );
      const css = assets
        .filter((output) => output.fileName.endsWith(".css"))
        .map((output) => String(output.source))
        .join("\n");

      expect(css).toContain('url("/docs/fonts/public.woff2")');
      expect(entry?.code).toContain("%3C%2Fdocs%2Ffonts%2Fpublic.woff2%3E");
      expect(assets.some((output) => output.fileName.startsWith("assets/fonts/"))).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps an explicitly external remote font URL without downloading it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-font-remote-"));
    try {
      await fs.writeFile(
        path.join(root, "entry.ts"),
        `import { remoteFont } from "@farm.js/core/font";
export const demo = remoteFont({
  src: "https://cdn.example.com/fonts/demo.woff2",
  family: "Remote Demo",
  strategy: "external",
  preload: false,
});
console.log(demo);`,
      );

      const result = await buildFixture(root);
      const entry = result.output.find(
        (output): output is Rollup.OutputChunk => output.type === "chunk" && output.isEntry,
      );
      const assets = result.output.filter(
        (output): output is Rollup.OutputAsset => output.type === "asset",
      );
      const css = assets
        .filter((output) => output.fileName.endsWith(".css"))
        .map((output) => String(output.source))
        .join("\n");

      expect(css).toContain("https://cdn.example.com/fonts/demo.woff2");
      expect(entry?.code).toMatch(/preloads:\s*\[\]/);
      expect(assets.some((output) => output.fileName.startsWith("assets/fonts/"))).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("downloads and verifies a remote font for self-hosting", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-font-self-hosted-"));
    const fontBytes = Buffer.from("self-hosted-font");
    const integrity = `sha384-${createHash("sha384").update(fontBytes).digest("base64")}`;
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(fontBytes, {
          status: 200,
          headers: { "Content-Type": "font/woff2" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await fs.writeFile(
        path.join(root, "entry.ts"),
        `import { remoteFont } from "@farm.js/core/font";
export const demo = remoteFont({
  src: "https://fonts.example.test/self-hosted.woff2",
  family: "Self Hosted",
  integrity: ${JSON.stringify(integrity)},
});
console.log(demo);`,
      );

      const result = await buildFixture(root);
      const fontAsset = result.output.find(
        (output): output is Rollup.OutputAsset =>
          output.type === "asset" && output.fileName.startsWith("assets/fonts/"),
      );

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fontAsset?.fileName).toMatch(/^assets\/fonts\/self-hosted-h[a-f0-9]{12}\.woff2$/);
      expect(Buffer.from(fontAsset?.source || []).toString()).toBe("self-hosted-font");
    } finally {
      vi.unstubAllGlobals();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refetches remote fonts across builds and emits only the current asset", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-font-remote-rebuild-"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(Buffer.from("remote-font-v1"), { status: 200 }))
      .mockResolvedValueOnce(new Response(Buffer.from("remote-font-v2"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await fs.writeFile(
        path.join(root, "entry.ts"),
        `import { remoteFont } from "@farm.js/core/font";
export const demo = remoteFont({
  src: "https://fonts.example.test/rebuild.woff2",
  family: "Remote Rebuild",
});
console.log(demo);`,
      );

      await buildFixture(root);
      const secondResult = await buildFixture(root);
      const fontAssets = secondResult.output.filter(
        (output): output is Rollup.OutputAsset =>
          output.type === "asset" && output.fileName.startsWith("assets/fonts/"),
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fontAssets).toHaveLength(1);
      expect(Buffer.from(fontAssets[0].source).toString()).toBe("remote-font-v2");
    } finally {
      vi.unstubAllGlobals();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("stops reading a remote font as soon as it exceeds 20 MB", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-font-remote-limit-"));
    const cancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (pulls === 25) controller.close();
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 200 })),
    );

    try {
      await fs.writeFile(
        path.join(root, "entry.ts"),
        `import { remoteFont } from "@farm.js/core/font";
export const demo = remoteFont({
  src: "https://fonts.example.test/too-large.woff2",
  family: "Too Large",
});
console.log(demo);`,
      );

      await expect(buildFixture(root)).rejects.toThrow("font exceeds the 20 MB limit");
      expect(pulls).toBeLessThan(25);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("appends configured Link values without replacing generated preloads", () => {
    const headers = new Headers({
      Link: "</assets/fonts/demo.woff2>; rel=preload; as=font",
    });

    appendFarmLinkHeader(headers, "</api>; rel=preconnect");
    appendFarmLinkHeader(headers, "</api>; rel=preconnect");

    expect(headers.get("Link")).toBe(
      "</assets/fonts/demo.woff2>; rel=preload; as=font, </api>; rel=preconnect",
    );
  });

  it("keeps font preload headers on generated PPR cache-hit responses", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
      "utf8",
    );

    expect(source).toMatch(
      /farmFontPreloadHeader \? \{ "Link": farmFontPreloadHeader \} : \{\}\),\s+\.\.\.getPPRHeaders\("hit", pprConfig\)/,
    );
    expect(source).toContain("manageFarmDocumentPreloads(");
    expect(source).toContain("manageFarmLinkHeaderPreloads(");
    expect(source).toContain("isStreaming || !isBuffered || response.body === null");
    expect(source).toContain("appendFarmLinkHeader(headers, header.value);");
    expect(source).toContain(
      "applyFarmPreloadBudget(applyConfiguredResponseHeaders(response, pathname), pathname)",
    );
    expect(source).toContain("await copyFarmDocsFontAssetsToClient(root, clientOutputDir);");
    expect(source).toContain("resolveFarmDocsFontAssets(root).map");
    expect(source).toContain("fontAssets: ${JSON.stringify(farmDocsFontAssets)},");
    expect(source).toContain(
      "getApplicableLayouts(getFarmRoutePathname(pathname)).map((layout) => layout.module)",
    );
    expect(source).toContain('fontStylesheetHref: "/farm-fonts.css"');
    expect(source).toContain("await fs.writeFile(fontCssPath, normalizedFontCss)");
  });

  it("serves the same fingerprinted docs fonts in development", async () => {
    const source = await fs.readFile(path.join(process.cwd(), "src", "vite.ts"), "utf8");

    expect(source).toContain("resolveFarmDocsFontAssets(farmConfig.root)");
    expect(source).toContain("fontAssets: toFarmDocsPublicFontAssets(farmDocsFontAssetList)");
    expect(source).toContain("resolveFarmLayoutFonts(layoutModules)");
    expect(source).toContain('fontStylesheetHref: "/@farm/fonts.css"');
    expect(source).toContain('res.setHeader("Content-Type", "font/woff2")');
    expect(source).toContain(
      'res.setHeader("Cache-Control", "public, max-age=31536000, immutable")',
    );
    expect(source).toContain('requestMethod === "HEAD"');
  });

  it("replaces an earlier generated font section when client and SSR CSS are combined", () => {
    const clientCss = `.app { color: green; }
/* farm-fonts:start */
.old-font {}
/* farm-fonts:end */`;
    const serverCss = `/* farm-fonts:start */
.current-font {}
/* farm-fonts:end */\n`;

    const merged = mergeFarmFontCss(clientCss, serverCss);
    expect(merged).toContain(".app { color: green; }");
    expect(merged).toContain(".current-font {}");
    expect(merged).not.toContain(".old-font {}");
  });
});
