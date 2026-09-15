import { afterEach, describe, expect, it, vi } from "vitest";
import { generateFarmDevtoolsClientRuntime } from "../devtools-client";

describe("Farm DevTools client runtime", () => {
  it("installs the default shortcut-driven overlay", () => {
    const runtime = generateFarmDevtoolsClientRuntime({
      enabled: true,
      shortcut: "mod+shift+.",
    });

    expect(runtime).toContain('const launchParam = "__farm_devtools"');
    expect(runtime).toContain('const devtoolsPath = "/__farm/devtools"');
    expect(runtime).toContain('frame.src = devtoolsPath + "?embedded=1"');
    expect(runtime).toContain("window.__FARM_DEVTOOLS__ = { open, close, toggle }");
    expect(runtime).toContain("launchUrl.searchParams.delete(launchParam)");
    expect(runtime).toContain("width: min(1100px, calc(100vw - 48px))");
    expect(runtime).toContain("height: min(720px, calc(100dvh - 48px))");
    expect(runtime).toContain("background: rgb(0 0 0 / 0.32)");
    expect(runtime).toContain("backdrop-filter: blur(6px)");
    expect(runtime).toContain('"key":"."');
    expect(runtime).toContain('event.code === "Period"');
  });

  it("only accepts the views the DevTools UI renders", () => {
    const runtime = generateFarmDevtoolsClientRuntime({ enabled: true, shortcut: false });

    // The client's launch/deep-link allowlist must cover the built-in panels plus
    // the @farm.js/devtools views that reuse the same launcher. Stale views
    // silently fall back to Overview and strip a matching application hash at launch.
    expect(runtime).toContain(
      'const validViews = new Set(["overview", "routes", "api", "systems", "runtime", "raw", "inspect", "diagnostics"])',
    );
  });

  it("keeps the programmatic launcher without a keyboard shortcut", () => {
    const runtime = generateFarmDevtoolsClientRuntime({
      enabled: true,
      shortcut: false,
    });

    expect(runtime).toContain("window.__FARM_DEVTOOLS__ = { open, close, toggle }");
    expect(runtime).toContain("const shortcut = null");
  });

  it("omits the launcher when DevTools are disabled", () => {
    expect(generateFarmDevtoolsClientRuntime({ enabled: false, shortcut: false })).toBe("");
  });
});

describe("DevTools modal scroll lifecycle", () => {
  const host = window as unknown as {
    __FARM_DEVTOOLS__: { open(): void; close(): void };
    __FARM_DEVTOOLS_RUNTIME__?: { dispose(): void };
  };
  const install = () => {
    vi.useFakeTimers();
    window.eval(generateFarmDevtoolsClientRuntime({ enabled: true, shortcut: false }));
    return host.__FARM_DEVTOOLS__;
  };

  afterEach(() => {
    host.__FARM_DEVTOOLS_RUNTIME__?.dispose();
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("locks the page until dismissal, then restores inline styles and focus", () => {
    document.body.innerHTML = '<button id="launcher">DevTools</button>';
    const launcher = document.getElementById("launcher")!;
    launcher.focus();
    document.documentElement.style.setProperty("overflow-y", "scroll", "important");
    document.body.style.setProperty("overflow-x", "clip");
    document.body.style.setProperty("overscroll-behavior", "contain");
    const api = install();
    api.open();
    for (const element of [document.documentElement, document.body]) {
      expect(element.style.overflowY).toBe("hidden");
      expect(element.style.getPropertyPriority("overflow-y")).toBe("important");
      expect(element.style.getPropertyValue("overscroll-behavior")).toBe("none");
    }
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    api.close();
    expect(document.body.style.overflowY).toBe("hidden");
    vi.runAllTimers();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.documentElement.style.overflowY).toBe("scroll");
    expect(document.documentElement.style.getPropertyPriority("overflow-y")).toBe("important");
    expect(document.body.style.overflowX).toBe("clip");
    expect(document.body.style.getPropertyPriority("overflow-x")).toBe("");
    expect(document.body.style.overflowY).toBe("");
    expect(document.body.style.getPropertyValue("overscroll-behavior")).toBe("contain");
    expect(document.activeElement).toBe(launcher);
  });

  it("does not let wheel or touch gestures on the backdrop scroll the page", () => {
    install().open();
    const overlay = document.getElementById("__farm_devtools_overlay__")!;
    for (const type of ["wheel", "touchmove"]) {
      const event = new Event(type, { cancelable: true, bubbles: true });
      overlay.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it("can reopen while closing without an old timer removing the new modal", () => {
    const api = install();
    api.open();
    api.close();
    api.close();
    api.open();
    vi.runAllTimers();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.style.overflowY).toBe("hidden");
    api.close();
    vi.runAllTimers();
    expect(document.body.style.overflowY).toBe("");
  });

  it("restores page scrolling when the runtime is replaced or disposed", () => {
    install().open();
    install().open();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    host.__FARM_DEVTOOLS_RUNTIME__!.dispose();
    vi.runAllTimers();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.documentElement.style.overflowY).toBe("");
    expect(document.body.style.overflowY).toBe("");
  });

  it("preserves application styles changed while DevTools was open", () => {
    const api = install();
    api.open();
    document.body.style.setProperty("overflow-y", "auto", "important");
    api.close();
    vi.runAllTimers();
    expect(document.body.style.overflowY).toBe("auto");
    expect(document.body.style.getPropertyPriority("overflow-y")).toBe("important");
    expect(document.documentElement.style.overflowY).toBe("");
  });
});
