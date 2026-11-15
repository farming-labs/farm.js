import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPrefetchRuntime, type PrefetchRouter } from "./client.js";
import type { PrefetchRuntime, ResolvedPrefetchOptions } from "./types.js";

const wait = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function options(overrides: Partial<ResolvedPrefetchOptions> = {}): ResolvedPrefetchOptions {
  return { mode: "intent", intentDelayMs: 0, allow: [], deny: [], ...overrides };
}

function createRouter() {
  return {
    prefetch: vi.fn(async (_href: string) => {}),
    observeForPrefetch: vi.fn((_element: HTMLAnchorElement) => {}),
    unobserveForPrefetch: vi.fn((_element: HTMLAnchorElement) => {}),
  };
}

function hover(element: Element): void {
  element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
}

function leave(element: Element, to: Element | null): void {
  element.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));
}

function link(selector: string): HTMLAnchorElement {
  const element = document.querySelector<HTMLAnchorElement>(selector);
  if (!element) throw new Error(`No element matches ${selector}`);
  return element;
}

describe("startPrefetchRuntime", () => {
  const runtimes: PrefetchRuntime[] = [];

  function start(resolved: ResolvedPrefetchOptions, router?: PrefetchRouter | null) {
    const runtime = startPrefetchRuntime(resolved, window, router);
    runtimes.push(runtime);
    return runtime;
  }

  beforeEach(() => {
    window.history.replaceState(null, "", "/current");
    document.body.innerHTML = "";
  });

  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.close();
    delete document.documentElement.dataset.farmDocsRuntime;
    delete (window.navigator as unknown as Record<string, unknown>).connection;
    document.body.innerHTML = "";
  });

  it("prefetches a plain link on hover through router.prefetch", async () => {
    document.body.innerHTML = `<a id="about" href="/about"><span>About</span></a>`;
    const router = createRouter();
    start(options(), router);

    hover(link("#about span"));
    await wait();

    expect(router.prefetch).toHaveBeenCalledTimes(1);
    expect(router.prefetch).toHaveBeenCalledWith("/about");
  });

  it("cancels the intent when the pointer leaves before the delay", async () => {
    document.body.innerHTML = `<a id="about" href="/about">About</a>`;
    const router = createRouter();
    start(options({ intentDelayMs: 20 }), router);

    hover(link("#about"));
    leave(link("#about"), document.body);
    await wait(40);

    expect(router.prefetch).not.toHaveBeenCalled();
  });

  it("keeps the intent timer running while the pointer moves inside the link", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      document.body.innerHTML = `<a id="about" href="/about"><span>About</span></a>`;
      const router = createRouter();
      start(options({ intentDelayMs: 30 }), router);
      const span = link("#about span");

      hover(link("#about"));
      vi.advanceTimersByTime(20);
      leave(link("#about"), span);
      hover(span);
      vi.advanceTimersByTime(10);
      await Promise.resolve();

      // Fires 30ms after the first hover, not 30ms after entering the span.
      expect(router.prefetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefetches on focus and on touch", async () => {
    document.body.innerHTML = `<a id="a" href="/a">A</a><a id="b" href="/b">B</a>`;
    const router = createRouter();
    start(options(), router);

    link("#a").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await wait();
    link("#b").dispatchEvent(new Event("touchstart", { bubbles: true }));
    await wait();

    expect(router.prefetch.mock.calls).toEqual([["/a"], ["/b"]]);
  });

  async function hoverEach(selector: string): Promise<void> {
    // One at a time: a new hover replaces the pending intent of the last one.
    for (const anchor of document.querySelectorAll(selector)) {
      hover(anchor);
      await wait();
    }
  }

  it("skips links the router would not navigate to another page", async () => {
    document.body.innerHTML = `
      <a data-farm-link="" href="/link">Link</a>
      <a download href="/file.pdf">Download</a>
      <a target="_blank" href="/blank">Blank</a>
      <a href="${window.location.origin}/absolute">Absolute</a>
      <a href="#section">Hash</a>
      <a href="/current">Same page</a>
      <a href="/current#section">Same page, other hash</a>
      <a id="ok" href="/current?tab=2">Same path, other query</a>
    `;
    const router = createRouter();
    start(options(), router);

    await hoverEach("a:not(#ok)");
    expect(router.prefetch).not.toHaveBeenCalled();

    hover(link("#ok"));
    await wait();
    expect(router.prefetch.mock.calls).toEqual([["/current?tab=2"]]);
  });

  it("applies allow and deny route patterns, with deny winning", async () => {
    document.body.innerHTML = `
      <a href="/admin/users">Allowed and denied</a>
      <a href="/about">Not allowed</a>
      <a id="ok" href="/posts/1">Allowed</a>
    `;
    const router = createRouter();
    start(
      options({ allow: ["/posts/[id]", "/admin/[...rest]"], deny: ["/admin/[...rest]"] }),
      router,
    );

    await hoverEach("a:not(#ok)");
    expect(router.prefetch).not.toHaveBeenCalled();

    hover(link("#ok"));
    await wait();
    expect(router.prefetch.mock.calls).toEqual([["/posts/1"]]);
  });

  it("skips every link while the docs runtime owns navigation", async () => {
    document.documentElement.dataset.farmDocsRuntime = "true";
    document.body.innerHTML = `<a id="about" href="/about">About</a>`;
    const router = createRouter();
    start(options(), router);

    hover(link("#about"));
    await wait();

    expect(router.prefetch).not.toHaveBeenCalled();
  });

  it("lets a link choose its own mode with data-farm-prefetch", async () => {
    document.body.innerHTML = `
      <a id="none" data-farm-prefetch="none" href="/none">None</a>
      <a id="typo" data-farm-prefetch="hover" href="/typo">Typo</a>
      <a id="viewport" data-farm-prefetch="viewport" href="/viewport">Viewport</a>
      <a id="render" data-farm-prefetch="render" href="/render">Render</a>
    `;
    const router = createRouter();
    start(options(), router);
    await wait();

    expect(router.observeForPrefetch.mock.calls).toEqual([[link("#viewport")]]);
    expect(router.prefetch.mock.calls).toEqual([["/render"]]);

    hover(link("#none"));
    await wait();
    hover(link("#typo"));
    await wait();
    expect(router.prefetch.mock.calls).toEqual([["/render"]]);
  });

  it("hands viewport links to the router's observer, including links added later", async () => {
    document.body.innerHTML = `
      <a id="first" href="/first">First</a>
      <a target="_blank" href="/blank">Blank</a>
    `;
    const router = createRouter();
    start(options({ mode: "viewport" }), router);

    expect(router.observeForPrefetch.mock.calls).toEqual([[link("#first")]]);

    const section = document.createElement("section");
    section.innerHTML = `<p><a id="later" href="/later">Later</a></p>`;
    document.body.append(section);
    await wait();
    expect(router.observeForPrefetch).toHaveBeenLastCalledWith(link("#later"));

    const later = link("#later");
    section.remove();
    await wait();
    expect(router.unobserveForPrefetch.mock.calls).toEqual([[later]]);

    hover(link("#first"));
    await wait();
    expect(router.prefetch).not.toHaveBeenCalled();
  });

  it("re-observes a viewport link after it moves", async () => {
    document.body.innerHTML = `<div id="a"><a id="link" href="/x">X</a></div><div id="b"></div>`;
    const router = createRouter();
    start(options({ mode: "viewport" }), router);

    link("#b").append(link("#link"));
    await wait();

    expect(router.unobserveForPrefetch).toHaveBeenCalledTimes(1);
    expect(router.observeForPrefetch).toHaveBeenCalledTimes(2);
  });

  it("skips viewport links when the router has no observer", async () => {
    document.body.innerHTML = `<a href="/about">About</a>`;
    const router = { prefetch: vi.fn(async () => {}) };

    expect(() => start(options({ mode: "viewport" }), router)).not.toThrow();
    await wait();
    expect(router.prefetch).not.toHaveBeenCalled();
  });

  it("prefetches render links once each", async () => {
    document.body.innerHTML = `<div id="list"><a id="one" href="/one">One</a></div>`;
    const router = createRouter();
    start(options({ mode: "render" }), router);
    await wait();
    expect(router.prefetch.mock.calls).toEqual([["/one"]]);

    const one = link("#one");
    one.remove();
    link("#list").append(one);
    link("#list").insertAdjacentHTML("beforeend", `<a href="/two">Two</a>`);
    await wait();

    expect(router.prefetch.mock.calls).toEqual([["/one"], ["/two"]]);
  });

  it("close() stops listening, cancels the pending intent and hands back observed links", async () => {
    document.body.innerHTML = `
      <a id="viewport" data-farm-prefetch="viewport" href="/viewport">Viewport</a>
      <a id="intent" href="/intent">Intent</a>
    `;
    const router = createRouter();
    const runtime = start(options({ intentDelayMs: 20 }), router);

    hover(link("#intent"));
    runtime.close();
    runtime.close();
    await wait(40);

    expect(router.prefetch).not.toHaveBeenCalled();
    expect(router.unobserveForPrefetch.mock.calls).toEqual([[link("#viewport")]]);

    hover(link("#intent"));
    document.body.insertAdjacentHTML(
      "beforeend",
      `<a data-farm-prefetch="render" href="/after">After</a>`,
    );
    await wait(40);
    expect(router.prefetch).not.toHaveBeenCalled();
  });

  it("stays off without router.prefetch", async () => {
    document.body.innerHTML = `<a id="about" data-farm-prefetch="viewport" href="/about">About</a>`;
    const observeForPrefetch = vi.fn();

    start(options(), { observeForPrefetch });
    start(options(), null);
    start(options(), undefined);
    hover(link("#about"));
    await wait();

    expect(observeForPrefetch).not.toHaveBeenCalled();
  });

  it("stays off when the browser asks to save data", async () => {
    Object.defineProperty(window.navigator, "connection", {
      configurable: true,
      value: { saveData: true },
    });
    document.body.innerHTML = `
      <a id="about" href="/about">About</a>
      <a data-farm-prefetch="viewport" href="/viewport">Viewport</a>
    `;
    const router = createRouter();
    start(options(), router);

    hover(link("#about"));
    await wait();

    expect(router.prefetch).not.toHaveBeenCalled();
    expect(router.observeForPrefetch).not.toHaveBeenCalled();
  });

  it("leaves a failed prefetch to the click", async () => {
    document.body.innerHTML = `<a id="a" href="/a">A</a><a id="b" href="/b">B</a>`;
    const router = {
      prefetch: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("sync failure");
        })
        .mockImplementationOnce(() => Promise.reject(new Error("async failure")))
        .mockImplementation(async () => {}),
    };
    start(options(), router);

    hover(link("#a"));
    await wait();
    hover(link("#b"));
    await wait();
    hover(link("#a"));
    await wait();

    expect(router.prefetch.mock.calls).toEqual([["/a"], ["/b"], ["/a"]]);
  });
});
