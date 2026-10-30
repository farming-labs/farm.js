import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmRscViteConfig,
  farmAppUsesRscPipeline,
  farmConfigUsesServerComponents,
} from "../rsc-pipeline";
import { logger } from "../utils";

const roots: string[] = [];

/** An app whose RSC packages record what the Farm config hands them. */
function createApp(packages: { plugin?: boolean; rsc?: boolean; flight?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "farm-rsc-config-"));
  roots.push(root);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", type: "module" }));
  const addPackage = (name: string, manifest: object, files: Record<string, string>) => {
    const dir = path.join(root, "node_modules", ...name.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name, type: "module", ...manifest }),
    );
    for (const [file, source] of Object.entries(files)) writeFileSync(path.join(dir, file), source);
  };
  if (packages.plugin !== false) {
    // Only an import condition, as the real package exports it.
    addPackage(
      "@farm.js/plugin",
      { exports: { "./rsc": { types: "./rsc.d.ts", import: "./rsc.js" } } },
      {
        "rsc.js": `export function defineConfig(config) { return { farm: config, plugins: config.plugins, server: { port: config.port } }; }
export function nitro(options) { return { name: "nitro", options }; }`,
      },
    );
  }
  if (packages.rsc !== false) {
    addPackage(
      "@vitejs/plugin-rsc",
      { exports: { ".": { import: "./index.js" } } },
      { "index.js": `export default function rsc(options) { return { name: "rsc", options }; }` },
    );
  }
  if (packages.flight !== false) addPackage("react-server-dom-webpack", {}, {});
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("experimental.serverComponents from farm.config", () => {
  it("is on only when the flag is true", () => {
    expect(farmConfigUsesServerComponents({ experimental: { serverComponents: true } })).toBe(true);
    expect(farmConfigUsesServerComponents({ experimental: { serverComponents: false } })).toBe(
      false,
    );
    expect(farmConfigUsesServerComponents({})).toBe(false);
    expect(farmConfigUsesServerComponents(undefined)).toBe(false);
  });

  it("keeps apps without the RSC packages on the normal pipeline, with one warning", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const flag = { experimental: { serverComponents: true } };
    // Starters set the flag before it loaded the RSC pipeline; they must keep working.
    expect(farmAppUsesRscPipeline(flag, createApp({ plugin: false, rsc: false }))).toBe(false);
    expect(farmAppUsesRscPipeline(flag, createApp({ plugin: false, rsc: false }))).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain(
      "@farm.js/plugin, @vitejs/plugin-rsc are not installed, so the app runs without React Server Components. `farm dev` and `farm build` install them",
    );
    expect(farmAppUsesRscPipeline(flag, createApp())).toBe(true);
    expect(farmAppUsesRscPipeline({}, createApp())).toBe(false);
  });

  it("keeps islands mode off the rsc pipeline, and takes it for an explicit rsc mode without packages", () => {
    // Islands mode runs on Farm's own pipeline, never the RSC one.
    expect(
      farmAppUsesRscPipeline(
        { experimental: { serverComponents: { mode: "islands" } } },
        createApp(),
      ),
    ).toBe(false);
    // `{ mode: "rsc" }` takes the pipeline, which then names the packages to install.
    expect(
      farmAppUsesRscPipeline(
        { experimental: { serverComponents: { mode: "rsc" } } },
        createApp({ plugin: false, rsc: false }),
      ),
    ).toBe(true);
  });

  it("configures the RSC pipeline on @vitejs/plugin-rsc from the Farm config", async () => {
    const root = createApp();
    const middleware = () => undefined;
    const appPlugin = { name: "app-plugin" };
    const config = (await createFarmRscViteConfig(
      {
        srcDir: "web",
        basePath: "/docs",
        middleware,
        images: { provider: "none" },
        md: false,
        i18n: { locales: ["en"], defaultLocale: "en" },
        experimental: { serverComponents: true, serverActions: true },
        vite: {
          plugins: [appPlugin, { name: "@tailwindcss/vite:scan" }],
          resolve: { alias: { "#app": "/web" } },
        },
      },
      { root, command: "build", preset: "node-server", outputDir: ".farm/.output" },
    )) as Record<string, any>;

    expect(config.root).toBe(root);
    expect(config.configFile).toBe(false);
    expect(config.mode).toBe("production");
    expect(config.farm).toMatchObject({
      srcDir: "web",
      basePath: "/docs",
      middleware,
      images: { provider: "none" },
      md: false,
      experimental: { serverComponents: true, serverActions: true },
    });
    // Read by the pipeline's own config hook rather than defineConfig.
    expect(config.i18n).toEqual({ locales: ["en"], defaultLocale: "en" });
    expect(config.resolve).toEqual({ alias: { "#app": "/web" } });

    const plugins = config.plugins.flat(Infinity) as Array<{ name: string }>;
    const names = plugins.map((plugin) => plugin.name);
    // The app's own Tailwind plugin is not added twice.
    expect(names).toEqual(["app-plugin", "@tailwindcss/vite:scan", "rsc", "nitro"]);
    const byName = Object.fromEntries(plugins.map((plugin) => [plugin.name, plugin]));
    expect(byName.rsc.options).toEqual({
      serverHandler: false,
      entries: {
        rsc: "./.farm/rsc-entries/entry.rsc.tsx",
        ssr: "./.farm/rsc-entries/entry.ssr.tsx",
        client: "./.farm/rsc-entries/entry.browser.tsx",
      },
    });
    // The build lands where farm start and the platform look for it.
    expect(byName.nitro.options.config).toEqual({
      preset: "node-server",
      outputDir: path.join(root, ".farm", ".output"),
    });
  });

  it("gives development Fast Refresh with core's plugin-react when the app has none", async () => {
    // The RSC client bootstrap imports /@react-refresh in development.
    const config = (await createFarmRscViteConfig(
      { experimental: { serverComponents: true } },
      { root: createApp(), command: "serve" },
    )) as Record<string, any>;
    const names = (config.plugins.flat(Infinity) as Array<{ name: string }>).map(
      (plugin) => plugin.name,
    );
    expect(names).toContain("vite:react-refresh");
  });

  it("keeps the app's own plugin-react instead of adding core's", async () => {
    const config = (await createFarmRscViteConfig(
      {
        experimental: { serverComponents: true },
        vite: { plugins: [{ name: "vite:react-refresh" }, { name: "@tailwindcss/vite:scan" }] },
      },
      { root: createApp(), command: "serve" },
    )) as Record<string, any>;
    const names = (config.plugins.flat(Infinity) as Array<{ name: string }>).map(
      (plugin) => plugin.name,
    );
    expect(names.filter((name) => name === "vite:react-refresh")).toHaveLength(1);
  });

  it("names the packages to install when they are missing", async () => {
    for (const missing of [{ plugin: false }, { rsc: false }, { flight: false }]) {
      await expect(
        createFarmRscViteConfig(
          { experimental: { serverComponents: true } },
          { root: createApp(missing), command: "serve" },
        ),
      ).rejects.toThrow(
        "Install them: pnpm add @farm.js/plugin @vitejs/plugin-rsc react-server-dom-webpack",
      );
    }
  });

  it("rejects other renderers", async () => {
    await expect(
      createFarmRscViteConfig(
        { renderer: { name: "vue" }, experimental: { serverComponents: true } },
        { root: createApp(), command: "serve" },
      ),
    ).rejects.toThrow('needs the React renderer; this app uses "vue"');
  });

  it("refuses to start RSC without config that protects requests, and warns about the rest", () => {
    const root = createApp();
    // auth would silently stop protecting pages, so this is an error, not a warning.
    expect(() =>
      farmAppUsesRscPipeline(
        { auth: true, integrations: { stripe: {} }, experimental: { serverComponents: true } },
        root,
      ),
    ).toThrow(
      "does not run `auth`, `integrations` yet. Serving the app without them could expose what they protect",
    );

    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(
      farmAppUsesRscPipeline(
        {
          plugins: [{ name: "devtools" }],
          storage: {},
          cron: false,
          integrations: {},
          experimental: { serverComponents: true },
        },
        root,
      ),
    ).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("does not run `plugins` yet. It is ignored.");
  });
});
