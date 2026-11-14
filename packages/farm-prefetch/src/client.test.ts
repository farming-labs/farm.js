import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPrefetchRuntime } from "./client.js";
import type { ResolvedPrefetchOptions } from "./types.js";

type ObserverEntry = { target: Element; isIntersecting: boolean };

class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = [];
  callback: (entries: ObserverEntry[]) => void;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: (entries: ObserverEntry[]) => void) {
    this.callback = callback;
    IntersectionObserverStub.instances.push(this);
  }

  trigger(entries: ObserverEntry[]): void {
    this.callback(entries);
  }
}

const tick = async (ms = 10): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

function baseOptions(overrides: Partial<ResolvedPrefetchOptions> = {}): ResolvedPrefetchOptions {
  return {
    strategy: "both",
    maxConcurrent: 6,
    allow: [],
    deny: [],
    hoverDelayMs: 0,
    ...overrides,
  };
}

describe("startPrefetchRuntime", () => {
  let originalObserver: unknown;
  let originalSaveData: unknown;

  beforeEach(() => {
    document.body.innerHTML = "";
    IntersectionObserverStub.instances = [];
    originalObserver = (window as unknown as Record<string, unknown>).IntersectionObserver;
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: IntersectionObserverStub,
    });
    originalSaveData = (window.navigator as unknown as Record<string, unknown>).connection;
  });

  afterEach(() => {
    if (originalObserver === undefined) {
      delete (window as unknown as Record<string, unknown>).IntersectionObserver;
    } else {
      Object.defineProperty(window, "IntersectionObserver", {
        configurable: true,
        value: originalObserver,
      });
    }
    if (originalSaveData === undefined) {
      delete (window.navigator as unknown as Record<string, unknown>).connection;
    } else {
      Object.defineProperty(window.navigator, "connection", {
        configurable: true,
        value: originalSaveData,
      });
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("prefetches a visible plain anchor and unobserves it", async () => {
    document.body.innerHTML = `<a href="/about">About</a>`;
    const anchor = document.querySelector("a") as HTMLAnchorElement;
    const router = { prefetch: vi.fn(async () => {}) };

    startPrefetchRuntime(baseOptions({ strategy: "viewport" }), window, router);
    const observer = IntersectionObserverStub.instances[0];
    expect(observer.observe).toHaveBeenCalledWith(anchor);

    observer.trigger([{ target: anchor, isIntersecting: true }]);
    await tick();

    expect(router.prefetch).toHaveBeenCalledOnce();
    expect(router.prefetch).toHaveBeenCalledWith("http://localhost:3000/about");
    expect(observer.unobserve).toHaveBeenCalledWith(anchor);
  });

  it("prefetches on hover after the delay, and a leave cancels it", async () => {
    document.body.innerHTML = `<a href="/pricing">Pricing</a>`;
    const anchor = document.querySelector("a") as HTMLAnchorElement;
    const router = { prefetch: vi.fn(async () => {}) };

    startPrefetchRuntime(baseOptions({ strategy: "hover", hoverDelayMs: 50 }), window, router);

    anchor.dispatchEvent(new window.Event("pointerenter"));
    anchor.dispatchEvent(new window.Event("pointerleave"));
    await tick(120);
    expect(router.prefetch).not.toHaveBeenCalled();

    anchor.dispatchEvent(new window.Event("pointerenter"));
    await tick(120);
    expect(router.prefetch).toHaveBeenCalledOnce();
  });

  it("skips Link-managed, external, download, _blank, opted-out and hash-only links", async () => {
    document.body.innerHTML = `
      <a href="/ok">ok</a>
      <a href="/link" data-farm-link="">link</a>
      <a href="https://other.example/x">external</a>
      <a href="/file.pdf" download>download</a>
      <a href="/new" target="_blank">blank</a>
      <a href="/off" data-farm-prefetch="off">off</a>
      <a href="#section">hash</a>`;
    const router = { prefetch: vi.fn(async () => {}) };

    startPrefetchRuntime(baseOptions({ strategy: "viewport" }), window, router);
    const observer = IntersectionObserverStub.instances[0];
    for (const anchor of document.querySelectorAll("a")) {
      observer.trigger([{ target: anchor, isIntersecting: true }]);
    }
    await tick();

    expect(router.prefetch).toHaveBeenCalledOnce();
    expect(router.prefetch).toHaveBeenCalledWith("http://localhost:3000/ok");
  });

  it("applies the allow and deny lists", async () => {
    document.body.innerHTML = `
      <a href="/posts/42">post</a>
      <a href="/admin/users">admin</a>
      <a href="/about">about</a>`;
    const router = { prefetch: vi.fn(async () => {}) };

    startPrefetchRuntime(
      baseOptions({
        strategy: "viewport",
        allow: ["/posts/[id]", "/admin/[...rest]"],
        deny: ["/admin/[...rest]"],
      }),
      window,
      router,
    );
    const observer = IntersectionObserverStub.instances[0];
    for (const anchor of document.querySelectorAll("a")) {
      observer.trigger([{ target: anchor, isIntersecting: true }]);
    }
    await tick();

    expect(router.prefetch).toHaveBeenCalledOnce();
    expect(router.prefetch).toHaveBeenCalledWith("http://localhost:3000/posts/42");
  });

  it("stays inert for data-saving users", async () => {
    Object.defineProperty(window.navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    });
    document.body.innerHTML = `<a href="/about">About</a>`;
    const router = { prefetch: vi.fn(async () => {}) };

    const runtime = startPrefetchRuntime(baseOptions(), window, router);
    expect(IntersectionObserverStub.instances).toHaveLength(0);
    runtime.close();
    expect(router.prefetch).not.toHaveBeenCalled();
  });

  it("stays inert without a router prefetch", async () => {
    document.body.innerHTML = `<a href="/about">About</a>`;
    const runtime = startPrefetchRuntime(baseOptions(), window, {});
    expect(IntersectionObserverStub.instances).toHaveLength(0);
    runtime.close();
  });

  it("picks up anchors added after start", async () => {
    const router = { prefetch: vi.fn(async () => {}) };
    startPrefetchRuntime(baseOptions({ strategy: "viewport" }), window, router);

    const anchor = document.createElement("a");
    anchor.href = "/late";
    anchor.textContent = "late";
    document.body.append(anchor);
    await tick(30);

    const observer = IntersectionObserverStub.instances[0];
    expect(observer.observe).toHaveBeenCalledWith(anchor);
    observer.trigger([{ target: anchor, isIntersecting: true }]);
    await tick();
    expect(router.prefetch).toHaveBeenCalledWith("http://localhost:3000/late");
  });

  it("caps concurrent prefetches", async () => {
    document.body.innerHTML = `
      <a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>`;
    const resolvers = new Map<string, () => void>();
    const router = {
      prefetch: vi.fn((href: string) => {
        return new Promise<void>((resolve) => resolvers.set(href, resolve));
      }),
    };

    startPrefetchRuntime(baseOptions({ strategy: "viewport", maxConcurrent: 2 }), window, router);
    const observer = IntersectionObserverStub.instances[0];
    for (const anchor of document.querySelectorAll("a")) {
      observer.trigger([{ target: anchor, isIntersecting: true }]);
    }
    await tick();

    expect(router.prefetch).toHaveBeenCalledTimes(2);
    resolvers.get("http://localhost:3000/a")?.();
    await tick();
    expect(router.prefetch).toHaveBeenCalledTimes(3);
    expect(router.prefetch).toHaveBeenCalledWith("http://localhost:3000/c");
  });

  it("stops everything on close", async () => {
    document.body.innerHTML = `<a href="/about">About</a>`;
    const anchor = document.querySelector("a") as HTMLAnchorElement;
    const router = { prefetch: vi.fn(async () => {}) };

    const runtime = startPrefetchRuntime(baseOptions(), window, router);
    const observer = IntersectionObserverStub.instances[0];
    runtime.close();

    expect(observer.disconnect).toHaveBeenCalled();
    anchor.dispatchEvent(new window.Event("pointerenter"));
    observer.trigger([{ target: anchor, isIntersecting: true }]);
    await tick();
    expect(router.prefetch).not.toHaveBeenCalled();
  });
});
