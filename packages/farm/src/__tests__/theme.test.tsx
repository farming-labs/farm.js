import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { _runWithCurrentRequest } from "../server/request";
import { getTheme as getClientTheme, setTheme, useTheme } from "../theme/client";
import { resolveFarmThemeConfig } from "../theme/config";
import { _setDefaultFarmThemeConfig, getTheme } from "../theme/server";
import {
  applyFarmThemeDocument,
  createFarmThemeBootstrapScript,
  createFarmThemeDocumentParts,
} from "../theme/server-runtime";
import { createFarmThemeCssPlugin } from "../theme/vite";

describe("FARMJS theme configuration", () => {
  it("is opt-in and resolves stable defaults", () => {
    expect(resolveFarmThemeConfig(undefined, "/shop/")).toEqual({
      enabled: false,
      default: "system",
      storageKey: "farm-theme",
      cookiePath: "/shop",
    });
    expect(resolveFarmThemeConfig({ default: "dark", storageKey: "acme-theme" })).toEqual({
      enabled: true,
      default: "dark",
      storageKey: "acme-theme",
      cookiePath: "/",
    });
  });

  it("is resolved through defineConfig with the application base path", async () => {
    const config = await resolveConfig(
      {
        basePath: "/console",
        theme: { default: "dark", storageKey: "console-theme" },
      },
      "production",
    );

    expect(config.theme).toEqual({
      enabled: true,
      default: "dark",
      storageKey: "console-theme",
      cookiePath: "/console",
    });
  });

  it("rejects storage keys that cannot be safely used as cookies", () => {
    expect(() => resolveFarmThemeConfig({ storageKey: "theme; Secure" })).toThrow(
      "theme.storageKey",
    );
    expect(() => resolveFarmThemeConfig({ default: "sepia" as any })).toThrow("theme.default");
  });

  it("reads the visitor preference from the request cookie", async () => {
    _setDefaultFarmThemeConfig({ default: "system", storageKey: "site-theme" });
    const request = new Request("https://farmjs.dev/dashboard", {
      headers: { cookie: "session=one; site-theme=dark" },
    });

    await expect(_runWithCurrentRequest(request, () => getTheme())).resolves.toBe("dark");
  });

  it("falls back to the configured default when no request context exists", () => {
    // Runtimes with partial AsyncLocalStorage support can lose the request
    // store mid-render; the theme read must degrade instead of throwing.
    _setDefaultFarmThemeConfig({ default: "dark", storageKey: "site-theme" });

    expect(getTheme()).toBe("dark");
  });

  it("shares the request snapshot across isolated dev SSR module graphs", async () => {
    _setDefaultFarmThemeConfig({ default: "dark", storageKey: "site-theme" });
    const request = new Request("https://farmjs.dev/dashboard", {
      headers: { cookie: "site-theme=light" },
    });

    vi.resetModules();
    const isolatedBridge = await import("../theme/bridge");
    const snapshot = await _runWithCurrentRequest(request, () =>
      isolatedBridge.getFarmThemeServerSnapshot(),
    );

    expect(snapshot).toEqual({ theme: "light", resolvedTheme: "light", mounted: false });
  });
});

describe("FARMJS theme document runtime", () => {
  it("injects a pre-paint script, color scheme, and initial selector once", () => {
    const config = resolveFarmThemeConfig({ default: "dark" });
    const parts = createFarmThemeDocumentParts(config);
    const source = '<!DOCTYPE html><html lang="en"><head></head><body>Farm</body></html>';
    const themed = applyFarmThemeDocument(source, config);

    expect(parts.attributes).toBe(' data-theme="dark"');
    expect(themed).toContain('<html lang="en" data-theme="dark">');
    expect(themed).toContain('id="farm-theme-style"');
    expect(themed).toContain('id="farm-theme-script"');
    expect(createFarmThemeBootstrapScript(config)).not.toContain("__name");
    expect(applyFarmThemeDocument(themed, config).match(/id="farm-theme-script"/g)).toHaveLength(1);
  });

  it("adds a selector-driven Tailwind dark variant without replacing a custom one", async () => {
    const plugin = createFarmThemeCssPlugin({ default: "system" });
    const transform = plugin.transform as any;
    const generated = await transform.call({}, '@import "tailwindcss";\n', "/app/globals.css");
    const custom = '@import "tailwindcss";\n@custom-variant dark (&:where(.night *));\n';

    expect(generated.code).toContain('[data-theme="dark"]');
    expect(await transform.call({}, custom, "/app/globals.css")).toBeNull();
  });
});

describe("FARMJS client theme API", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | undefined;
  let systemDark = false;
  let systemListener: (() => void) | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    document.documentElement.removeAttribute("data-theme");
    document.cookie = "farm-theme=; Path=/; Max-Age=0";
    localStorage.clear();
    delete window.__FARM_THEME__;
    systemDark = false;
    systemListener = undefined;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        get matches() {
          return systemDark;
        },
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: (_event: string, listener: () => void) => {
          systemListener = listener;
        },
        removeEventListener: () => {},
        addListener: (listener: () => void) => {
          systemListener = listener;
        },
        removeListener: () => {},
        dispatchEvent: () => true,
      }),
    });
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container.remove();
    root = undefined;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it("persists changes and follows system color-scheme updates", () => {
    window.eval(createFarmThemeBootstrapScript(resolveFarmThemeConfig({ default: "dark" })));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(getClientTheme()).toMatchObject({ theme: "dark", resolvedTheme: "dark" });

    setTheme("system");
    expect(document.cookie).toContain("farm-theme=system");
    expect(document.documentElement.dataset.theme).toBe("light");

    systemDark = true;
    systemListener?.();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(getClientTheme()).toMatchObject({ theme: "system", resolvedTheme: "dark" });
  });

  it("keeps hydration aligned with the server while applying a stored preference", () => {
    document.cookie = "farm-theme=light; Path=/";
    const config = resolveFarmThemeConfig({ default: "dark" });

    window.eval(createFarmThemeBootstrapScript(config, "dark"));

    expect(window.__FARM_THEME__?.serverSnapshot).toEqual({
      theme: "dark",
      resolvedTheme: "dark",
      mounted: false,
    });
    expect(window.__FARM_THEME__?.snapshot).toEqual({
      theme: "light",
      resolvedTheme: "light",
      mounted: true,
    });
  });

  it("notifies useTheme subscribers without changing control width or markup", () => {
    window.eval(createFarmThemeBootstrapScript(resolveFarmThemeConfig({ default: "dark" })));

    function ThemeStatus() {
      const theme = useTheme();
      return createElement("output", null, `${theme.theme}:${theme.resolvedTheme}`);
    }

    act(() => {
      root = createRoot(container);
      root.render(createElement(ThemeStatus));
    });
    expect(container.textContent).toBe("dark:dark");

    act(() => setTheme("light"));
    expect(container.textContent).toBe("light:light");
  });
});
