/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { installChunkErrorRecovery, isChunkLoadError } from "../client/chunk-recovery";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("chunk error recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects dynamic import and bundler chunk load failures", () => {
    expect(
      isChunkLoadError(
        new TypeError("Failed to fetch dynamically imported module: /assets/page.abc123.js"),
      ),
    ).toBe(true);
    expect(
      isChunkLoadError({
        name: "ChunkLoadError",
        message: "Loading chunk dashboard failed.",
      }),
    ).toBe(true);
    expect(isChunkLoadError(new Error("User profile request failed"))).toBe(false);
  });

  it("detects script and css resource load failures", () => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/assets/app.abc123.js";
    const scriptEvent = new Event("error");
    Object.defineProperty(scriptEvent, "target", { value: script });

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/assets/app.abc123.css";
    const linkEvent = new Event("error");
    Object.defineProperty(linkEvent, "target", { value: link });

    const preload = document.createElement("link");
    preload.rel = "modulepreload";
    preload.href = "/chunks/page.abc123.js";
    const preloadEvent = new Event("error");
    Object.defineProperty(preloadEvent, "target", { value: preload });

    expect(isChunkLoadError(scriptEvent)).toBe(true);
    expect(isChunkLoadError(linkEvent)).toBe(true);
    expect(isChunkLoadError(preloadEvent)).toBe(true);
  });

  it("ignores a same-origin classic script that is not a Farm chunk", () => {
    const storage = new MemoryStorage();
    const reload = vi.fn();
    const cleanup = installChunkErrorRecovery({ storage, reload, now: () => 1000 });

    // Vercel Analytics injects this script; it 404s on any host but Vercel.
    const script = document.createElement("script");
    script.defer = true;
    script.src = "/_vercel/insights/script.js";
    const event = new Event("error");
    Object.defineProperty(event, "target", { value: script });

    expect(isChunkLoadError(event)).toBe(false);
    window.dispatchEvent(event);
    expect(reload).not.toHaveBeenCalled();

    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = "/favicon.js";
    const iconEvent = new Event("error");
    Object.defineProperty(iconEvent, "target", { value: icon });
    expect(isChunkLoadError(iconEvent)).toBe(false);

    cleanup();
  });

  it("ignores load failures of cross-origin scripts and styles", () => {
    const script = document.createElement("script");
    script.src = "https://cdn.example.com/analytics.js";
    const scriptEvent = new Event("error");
    Object.defineProperty(scriptEvent, "target", { value: script });

    const link = document.createElement("link");
    link.href = "https://fonts.example.com/theme.css";
    const linkEvent = new Event("error");
    Object.defineProperty(linkEvent, "target", { value: link });

    expect(isChunkLoadError(scriptEvent)).toBe(false);
    expect(isChunkLoadError(linkEvent)).toBe(false);
  });

  it("does not reload when a third-party script keeps failing", () => {
    const storage = new MemoryStorage();
    const reload = vi.fn();
    const cleanup = installChunkErrorRecovery({
      storage,
      reload,
      now: () => 1000,
    });

    const script = document.createElement("script");
    script.src = "https://cdn.example.com/blocked-by-adblock.js";
    const event = new Event("error");
    Object.defineProperty(event, "target", { value: script });

    window.dispatchEvent(event);
    window.dispatchEvent(event);

    expect(reload).not.toHaveBeenCalled();

    cleanup();
  });

  it("reloads once for a chunk failure on the current page", () => {
    const storage = new MemoryStorage();
    const reload = vi.fn();
    const onRecover = vi.fn();
    const cleanup = installChunkErrorRecovery({
      storage,
      reload,
      onRecover,
      now: () => 1000,
      location: {
        pathname: "/products",
        search: "?tab=reviews",
        reload,
      } as any,
    });

    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", {
      value: new TypeError("Failed to fetch dynamically imported module"),
    });

    window.dispatchEvent(event);
    window.dispatchEvent(event);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(storage.getItem("farm:chunk-recovery:/products?tab=reviews")).toBe("1000");

    cleanup();
  });

  it("allows recovery again after the guard window expires", () => {
    const storage = new MemoryStorage();
    const reload = vi.fn();
    let now = 1000;
    const cleanup = installChunkErrorRecovery({
      storage,
      reload,
      now: () => now,
      maxAgeMs: 10,
      storageKey: "farm:test-chunk",
    });
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", {
      value: { code: "CSS_CHUNK_LOAD_FAILED" },
    });

    window.dispatchEvent(event);
    now = 1011;
    window.dispatchEvent(event);

    expect(reload).toHaveBeenCalledTimes(2);
    expect(storage.getItem("farm:test-chunk")).toBe("1011");

    cleanup();
  });
});
