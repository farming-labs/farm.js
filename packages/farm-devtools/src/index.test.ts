import { describe, expect, it } from "vitest";
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
        vite: { plugins: [other], base: "/lab/" },
      } as never,
      context(true),
    );
    expect(configured?.devtools).toEqual({ enabled: true, shortcut: false });
    expect(configured?.vite).toMatchObject({
      base: "/lab/",
      plugins: [{ name: "farm:devtools-ui", apply: "serve", enforce: "pre" }, other],
    });
    expect(plugin.client?.public).toEqual({ launcher: true });
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
    expect(plugin.client?.public).toEqual({ launcher: false });
    expect(
      await plugin.client?.setup?.({ isDev: true, public: { launcher: false } } as never),
    ).toBeUndefined();
    const configured = await plugin.configure!({ plugins: [plugin] } as never, context(true));
    expect(configured?.devtools).toMatchObject({ enabled: true, shortcut: "mod+shift+d" });
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
