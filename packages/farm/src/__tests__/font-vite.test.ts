// @vitest-environment node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { build, createServer, type Plugin, type Rollup } from "vite";
import { describe, expect, it, vi } from "vitest";
import { farmFontImportsPlugin, mergeFarmFontCss, renderFarmFontDevHead } from "../font-vite";
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
      plugins: [fontRuntimeStub(), farmFontImportsPlugin({ root })],
      server: { middlewareMode: true },
    });
    const http = createHttpServer(vite.middlewares);

    try {
      const transformed = await vite.transformRequest("/entry.ts");
      expect(transformed?.code).toContain("farm-font-");
      expect(transformed?.code).not.toContain("font-runtime-stub");
      expect(transformed?.code).not.toContain("@farm.js/core/font");
      expect(renderFarmFontDevHead(root)).toContain('<link rel="preload"');
      expect(renderFarmFontDevHead(root)).toContain('href="/@farm/fonts.css"');

      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      const address = http.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address");
      const origin = `http://127.0.0.1:${address.port}`;
      const css = await fetch(`${origin}/@farm/fonts.css`).then((response) => response.text());
      const fontPath = css.match(/url\("([^"]+)"\)/)?.[1];

      expect(css).toContain('font-family: "Dev Demo"');
      expect(fontPath).toMatch(/^\/@farm\/font\/[a-f0-9]{12}\.woff2$/);
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
      expect(entry?.code).not.toContain("localFont({");
      expect(entry?.code).not.toContain("__FARM_FONT_PRELOAD_HEADER__");
      expect(entry?.code).toContain("%3C%2Fassets%2Ffonts%2Fdemo-");
      expect(css).toContain("@font-face");
      expect(css).toContain('font-family: "Demo Sans"');
      expect(css).toContain("font-display: swap");
      expect(css).toContain("--font-demo:");
      expect(fontAsset?.fileName).toMatch(/^assets\/fonts\/demo-[a-f0-9]{12}\.woff2$/);
      expect(Buffer.from(fontAsset?.source || []).toString()).toBe("test-font-binary");
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
      const assets = result.output.filter(
        (output): output is Rollup.OutputAsset => output.type === "asset",
      );
      const css = assets
        .filter((output) => output.fileName.endsWith(".css"))
        .map((output) => String(output.source))
        .join("\n");

      expect(css).toContain("https://cdn.example.com/fonts/demo.woff2");
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
      expect(fontAsset?.fileName).toMatch(/^assets\/fonts\/self-hosted-[a-f0-9]{12}\.woff2$/);
      expect(Buffer.from(fontAsset?.source || []).toString()).toBe("self-hosted-font");
    } finally {
      vi.unstubAllGlobals();
      await fs.rm(root, { recursive: true, force: true });
    }
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
