import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build as viteBuild } from "vite";
import { stylex } from "./index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  delete (globalThis as Record<string, unknown>).__stylex_unplugin_store;
});

describe("stylex plugin", () => {
  it("prepends StyleX while preserving existing Vite options", async () => {
    const plugin = stylex({ externalPackages: ["@acme/ui"] });
    const configured = await plugin.configure?.(
      {
        plugins: [plugin],
        vite: {
          define: { __EXISTING__: "true" },
          plugins: [{ name: "existing" }],
        },
      },
      { config: {} as never, isDev: true, isProd: false } as never,
    );
    const vitePlugins = (configured as any).vite.plugins;

    expect(vitePlugins[0].name).toBe("@stylexjs/unplugin");
    expect(vitePlugins[0].enforce).toBe("pre");
    expect(vitePlugins[1].name).toBe("existing");
    expect((configured as any).vite.define).toEqual({ __EXISTING__: "true" });

    const dependencyConfig = vitePlugins[0].config({ optimizeDeps: {} });
    expect(dependencyConfig.optimizeDeps.exclude).toContain("@acme/ui");
    expect(dependencyConfig.ssr.optimizeDeps.exclude).toContain("@acme/ui");
  });

  it("injects development CSS before paint and the HMR runtime once", async () => {
    const plugin = stylex();
    await plugin.configure?.({ plugins: [plugin] }, {
      config: {} as never,
      isDev: true,
      isProd: false,
    } as never);
    const html = "<!doctype html><html><head><title>App</title></head><body></body></html>";
    const renderContext = { config: {} } as never;
    const first = await plugin.render?.html?.(html, { pathname: "/" }, renderContext);
    const second = await plugin.render?.html?.(first as string, { pathname: "/" }, renderContext);

    expect(first).toContain('<link rel="stylesheet" href="/virtual:stylex.css"');
    expect(first).toContain('<script type="module" src="/@id/virtual:stylex:runtime"');
    expect((second as string).match(/virtual:stylex\.css/g)).toHaveLength(1);
    expect((second as string).match(/virtual:stylex:runtime/g)).toHaveLength(1);
  });

  it("does not mistake page content for injected development assets", async () => {
    const plugin = stylex();
    await plugin.configure?.({ plugins: [plugin] }, {
      config: {} as never,
      isDev: true,
      isProd: false,
    } as never);
    const html =
      '<!doctype html><html><head></head><body><code>data-farm-stylex="css" data-farm-stylex="runtime"</code></body></html>';

    const result = await plugin.render?.html?.(html, { pathname: "/" }, { config: {} } as never);

    expect(result).toContain('<link rel="stylesheet" href="/virtual:stylex.css"');
    expect(result).toContain('<script type="module" src="/@id/virtual:stylex:runtime"');
  });

  it("does not inject development assets into production HTML", async () => {
    const plugin = stylex();
    await plugin.configure?.({ plugins: [plugin] }, {
      config: {} as never,
      isDev: false,
      isProd: true,
    } as never);
    const html = "<!doctype html><html><head></head><body></body></html>";

    expect(plugin.render?.html?.(html, { pathname: "/" }, {} as never)).toBe(html);
  });

  it("keeps production route evaluation transforms without development server hooks", async () => {
    const plugin = stylex();
    const configured = await plugin.configure?.({ plugins: [plugin] }, {
      config: {} as never,
      isDev: false,
      isProd: true,
    } as never);
    const vitePlugin = (configured as any).vite.plugins[0];

    expect(vitePlugin.apply({}, { command: "serve", mode: "production" })).toBe(true);
    expect(vitePlugin.transform).toBeTypeOf("function");
    expect(vitePlugin.configureServer).toBeUndefined();
    expect(vitePlugin.handleHotUpdate).toBeUndefined();
    expect(vitePlugin.transformIndexHtml).toBeUndefined();
  });

  it("includes rules collected from server route evaluation in client CSS", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".stylex-test-"));
    roots.push(root);
    await writeFile(path.join(root, "entry.ts"), 'import "./base.css";\n');
    await writeFile(path.join(root, "base.css"), "html { color-scheme: light; }\n");

    const plugin = stylex();
    const configured = await plugin.configure?.({ root, plugins: [plugin] }, {
      config: {} as never,
      isDev: false,
      isProd: true,
    } as never);
    const vitePlugin = (configured as any).vite.plugins[0];
    await vitePlugin.transform.call(
      {},
      [
        'import * as stylex from "@stylexjs/stylex";',
        "const styles = stylex.create({ marker: { color: 'rgb(91, 17, 203)' } });",
        "export const className = stylex.props(styles.marker).className;",
      ].join("\n"),
      path.join(root, "server-only.tsx"),
    );

    await viteBuild({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: (configured as any).vite.plugins,
      css: { postcss: { plugins: [] } },
      build: {
        outDir: "dist",
        lib: { entry: path.join(root, "entry.ts"), formats: ["es"] },
      },
    });

    const cssFiles = await findCssFiles(path.join(root, "dist"));
    expect(cssFiles).toHaveLength(1);
    expect(await readFile(cssFiles[0]!, "utf8")).toContain("#5b11cb");
  });

  it("rejects duplicate StyleX instances", async () => {
    const plugin = stylex();
    const other = stylex();
    expect(() =>
      plugin.configure?.({ plugins: [plugin, other] }, {
        config: {} as never,
        isDev: true,
        isProd: false,
      } as never),
    ).toThrow("one stylex() plugin instance");
  });

  it("compiles StyleX source shipped by an external package", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".stylex-test-"));
    roots.push(root);
    const packageRoot = path.join(root, "node_modules", "@acme", "ui");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "stylex-fixture",
        private: true,
        dependencies: { "@acme/ui": "1.0.0" },
      }),
    );
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@acme/ui",
        version: "1.0.0",
        type: "module",
        exports: "./index.tsx",
      }),
    );
    await writeFile(
      path.join(packageRoot, "index.tsx"),
      [
        'import * as stylex from "@stylexjs/stylex";',
        "const styles = stylex.create({ root: { backgroundColor: 'rgb(12, 34, 56)' } });",
        "export const className = stylex.props(styles.root).className;",
      ].join("\n"),
    );
    await writeFile(path.join(root, "entry.ts"), 'export { className } from "@acme/ui";\n');

    const plugin = stylex({ externalPackages: ["@acme/ui"] });
    const configured = await plugin.configure?.({ root, plugins: [plugin] }, {
      config: {} as never,
      isDev: false,
      isProd: true,
    } as never);
    await viteBuild({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: (configured as any).vite.plugins,
      css: { postcss: { plugins: [] } },
      build: {
        outDir: "dist",
        lib: { entry: path.join(root, "entry.ts"), formats: ["es"] },
      },
    });

    const cssFiles = await findCssFiles(path.join(root, "dist"));
    expect(cssFiles).toHaveLength(1);
    expect(await readFile(cssFiles[0]!, "utf8")).toContain("#0c2238");
  });
});

async function findCssFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await findCssFiles(entryPath)));
    else if (entry.name.endsWith(".css")) found.push(entryPath);
  }
  return found;
}
