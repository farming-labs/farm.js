import { describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { devtools } from "./index.js";

const context = (isDev: boolean) => ({ isDev, isProd: !isDev }) as never;

describe("devtools plugin", () => {
  it("opts into the UI while preserving Vite and existing DevTools configuration", async () => {
    const plugin = devtools();
    const other = { name: "existing" };
    const configured = await plugin.configure!(
      {
        plugins: [plugin],
        devtools: { shortcut: false },
        vite: {
          plugins: [other],
          base: "/lab/",
          optimizeDeps: { exclude: ["existing-exclusion"], include: ["existing-inclusion"] },
        },
      } as never,
      context(true),
    );
    expect(configured?.devtools).toEqual({ enabled: true, shortcut: false });
    expect(configured?.vite).toMatchObject({
      base: "/lab/",
      plugins: [{ name: "farm:devtools-ui", apply: "serve", enforce: "pre" }, other],
    });
    expect(configured?.vite?.optimizeDeps).toEqual({
      exclude: ["existing-exclusion", "@farm.js/devtools/internal/hmr"],
      include: ["existing-inclusion"],
    });
    expect(plugin.client?.public).toEqual({ launcher: true, inspect: true });
  });
  it("removes its client hooks and does not install Vite hooks in production", async () => {
    const plugin = devtools();
    const other = { name: "existing" };
    const configured = await plugin.configure!(
      { plugins: [plugin, other], vite: { base: "/lab/" } } as never,
      context(false),
    );
    expect(configured?.plugins).toEqual([other]);
    expect(configured?.vite).toEqual({ base: "/lab/" });
    expect(
      await plugin.client?.setup?.({ isDev: false, public: { launcher: true } } as never),
    ).toBeUndefined();
  });
  it("allows disabling the launcher without disabling inspection or shortcuts", async () => {
    const plugin = devtools({ launcher: false, inspect: false, shortcut: "mod+shift+d" });
    expect(plugin.client?.public).toEqual({ launcher: false, inspect: false });
    expect(
      await plugin.client?.setup?.({ isDev: true, public: { launcher: false } } as never),
    ).toBeUndefined();
    const configured = await plugin.configure!({ plugins: [plugin] } as never, context(true));
    expect(configured?.devtools).toMatchObject({ enabled: true, shortcut: "mod+shift+d" });
    expect(configured?.vite?.optimizeDeps).toBeUndefined();
  });
  it("hands the resolved Farm shortcut to the embedded panel", async () => {
    const embeddedHtml = async (config: Record<string, unknown>) => {
      const plugin = devtools({ inspect: false });
      const configured = await plugin.configure!(
        { plugins: [plugin], ...config } as never,
        context(true),
      );
      const [vitePlugin] = (configured!.vite as { plugins: Plugin[] }).plugins;
      let middleware!: Connect.NextHandleFunction;
      const server = {
        config: { root: process.cwd(), server: {} },
        middlewares: { use: (fn: Connect.NextHandleFunction) => (middleware = fn) },
      } as unknown as ViteDevServer;
      await (vitePlugin.configureServer as (server: ViteDevServer) => Promise<void>)(server);
      let body = "";
      await middleware(
        {
          url: "/__farm/devtools?embedded=1",
          method: "GET",
          headers: { host: "localhost:3000" },
        } as IncomingMessage,
        { setHeader() {}, end: (value: string) => (body = value) } as unknown as ServerResponse,
        () => {},
      );
      return body;
    };
    expect(await embeddedHtml({})).toContain('data-shortcut="mod+shift+."');
    expect(await embeddedHtml({ devtools: { shortcut: "Ctrl + K" } })).toContain(
      'data-shortcut="ctrl+k"',
    );
    expect(await embeddedHtml({ devtools: { shortcut: false } })).toContain('data-shortcut=""');
  });
  it("rejects contradictory configuration and duplicate instances", () => {
    const plugin = devtools();
    expect(() => plugin.configure!({ devtools: false } as never, context(true))).toThrow(
      "Remove devtools: false",
    );
    expect(() =>
      plugin.configure!({ devtools: { enabled: false } } as never, context(true)),
    ).toThrow("Remove devtools: false");
    expect(() =>
      plugin.configure!({ plugins: [plugin, devtools()] } as never, context(true)),
    ).toThrow("one devtools()");
  });
  it("validates options without an extra enabled flag", () => {
    expect(() => devtools({ inspect: "yes" } as never)).toThrow("inspect must be a boolean");
    expect(() => devtools({ shortcut: "" })).toThrow("shortcut");
    expect(() => devtools({ shortcut: "</script>" })).toThrow("shortcut");
  });
});
