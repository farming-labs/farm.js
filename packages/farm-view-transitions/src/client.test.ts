import { describe, expect, it, vi } from "vitest";
import { startViewTransitionsRuntime } from "./client.js";
import type { ViewTransitionsNavigationEvent } from "./types.js";

let sequence = 0;

function navigation(to: string): ViewTransitionsNavigationEvent {
  const url = new URL(to, "http://localhost");
  return {
    id: `navigation:${++sequence}`,
    to: { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash },
    action: "push",
  };
}

interface StartedTransition {
  /** The promise the runtime's update callback returned. */
  update: Promise<void> | undefined;
  skipTransition: ReturnType<typeof vi.fn>;
}

/**
 * A browser with a recording `document.startViewTransition`. Like the
 * real API, the stub invokes the update callback and keeps the returned
 * promise as `updateCallbackDone`.
 */
function createBrowser({
  supported = true,
  reducedMotion = false,
  throwing = false,
}: { supported?: boolean; reducedMotion?: boolean; throwing?: boolean } = {}) {
  const started: StartedTransition[] = [];
  const startViewTransition = vi.fn((callback: () => Promise<void>) => {
    if (throwing) throw new Error("transitions unavailable");
    const record: StartedTransition = { update: undefined, skipTransition: vi.fn() };
    record.update = callback();
    started.push(record);
    return {
      updateCallbackDone: record.update,
      ready: Promise.resolve(),
      finished: Promise.resolve(),
      skipTransition: record.skipTransition,
    };
  });
  const fakeWindow = {
    document: supported ? { startViewTransition } : {},
    matchMedia: (query: string) => ({ matches: reducedMotion && query.includes("reduce") }),
  };
  return {
    started,
    startViewTransition,
    start(exclude: string[] = []) {
      return startViewTransitionsRuntime(
        { exclude },
        fakeWindow as unknown as Window & typeof globalThis,
      );
    },
  };
}

/** Let queued promise continuations run. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function settled(update: Promise<void> | undefined): Promise<boolean> {
  let done = false;
  void update?.then(() => {
    done = true;
  });
  return flush().then(() => done);
}

describe("startViewTransitionsRuntime", () => {
  it("starts a transition on before and completes it on resolved", async () => {
    const browser = createBrowser();
    const runtime = browser.start();
    const event = navigation("/next");

    runtime.beginForNavigation(event);
    expect(browser.startViewTransition).toHaveBeenCalledTimes(1);
    await expect(settled(browser.started[0]!.update)).resolves.toBe(false);

    runtime.finishForNavigation(event);
    await expect(settled(browser.started[0]!.update)).resolves.toBe(true);
  });

  it("does not complete a transition for a different navigation", async () => {
    const browser = createBrowser();
    const runtime = browser.start();
    const event = navigation("/next");

    runtime.beginForNavigation(event);
    runtime.finishForNavigation(navigation("/other"));
    await expect(settled(browser.started[0]!.update)).resolves.toBe(false);

    runtime.finishForNavigation(event);
    await expect(settled(browser.started[0]!.update)).resolves.toBe(true);
  });

  it("is a no-op where the API is unsupported", async () => {
    const browser = createBrowser({ supported: false });
    const runtime = browser.start();
    const event = navigation("/next");

    expect(() => {
      runtime.beginForNavigation(event);
      runtime.finishForNavigation(event);
    }).not.toThrow();
    expect(browser.started).toHaveLength(0);
  });

  it("respects prefers-reduced-motion", () => {
    const browser = createBrowser({ reducedMotion: true });
    const runtime = browser.start();

    runtime.beginForNavigation(navigation("/next"));
    expect(browser.startViewTransition).not.toHaveBeenCalled();
  });

  it("skips excluded routes and animates the rest", () => {
    const browser = createBrowser();
    const runtime = browser.start(["/checkout", "/admin/:section"]);

    runtime.beginForNavigation(navigation("/checkout"));
    runtime.beginForNavigation(navigation("/admin/users"));
    expect(browser.startViewTransition).not.toHaveBeenCalled();

    runtime.beginForNavigation(navigation("/products"));
    expect(browser.startViewTransition).toHaveBeenCalledTimes(1);
  });

  it("releases a pending transition when a newer navigation starts", async () => {
    const browser = createBrowser();
    const runtime = browser.start();
    const first = navigation("/first");
    const second = navigation("/second");

    runtime.beginForNavigation(first);
    runtime.beginForNavigation(second);
    expect(browser.startViewTransition).toHaveBeenCalledTimes(2);
    // The superseded update callback resolves instead of hanging.
    await expect(settled(browser.started[0]!.update)).resolves.toBe(true);
    await expect(settled(browser.started[1]!.update)).resolves.toBe(false);

    runtime.finishForNavigation(second);
    await expect(settled(browser.started[1]!.update)).resolves.toBe(true);
  });

  it("survives a throwing startViewTransition", () => {
    const browser = createBrowser({ throwing: true });
    const runtime = browser.start();
    const event = navigation("/next");

    expect(() => {
      runtime.beginForNavigation(event);
      runtime.finishForNavigation(event);
    }).not.toThrow();
  });

  it("close releases a pending transition and disables the runtime", async () => {
    const browser = createBrowser();
    const runtime = browser.start();
    const event = navigation("/next");

    runtime.beginForNavigation(event);
    runtime.close();
    await expect(settled(browser.started[0]!.update)).resolves.toBe(true);

    runtime.beginForNavigation(navigation("/later"));
    expect(browser.startViewTransition).toHaveBeenCalledTimes(1);
  });
});
