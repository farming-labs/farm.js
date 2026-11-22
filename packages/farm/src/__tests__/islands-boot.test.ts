import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FARM_DEPLOYMENT_ID_HEADER } from "../deployment";
import { FARM_ISLAND_REPLAYABLE_SELECTOR } from "../island";
import {
  FARM_ISLANDS_BOOT_DEPLOYMENT_HEADER,
  FARM_ISLANDS_BOOT_REPLAYABLE_SELECTOR,
  FARM_ISLANDS_BOOT_VISIBLE_MARGIN,
  type FarmEarlyNavigation,
  startFarmIslandsBoot,
} from "../client/islands-boot";
import { observeIslandVisibility } from "../client/island-triggers";

type QueueWindow = Window & {
  __FARM_PREHYDRATION_CLICK_QUEUE__?: unknown[];
  __FARM_EARLY_NAVIGATION__?: FarmEarlyNavigation;
  __FARM_DEPLOYMENT_ID__?: string;
};

// A link click the boot holds requests its page; no test reaches the network.
let pageRequests: ReturnType<typeof vi.fn>;
beforeEach(() => {
  pageRequests = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", pageRequests);
});

let finishLoad: (() => void) | undefined;
let started: ReturnType<typeof vi.fn> | undefined;

/** Starts the boot with a runtime load that stays pending until the test finishes it. */
function boot(html: string) {
  document.body.innerHTML = html;
  const load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishLoad = resolve;
      }),
  );
  started = load;
  startFarmIslandsBoot(load);
  return load;
}

async function settle() {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

/** Clicks `target`; true when something on the page (the boot) prevented the default. */
function click(target: Element): boolean {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  let prevented: boolean | undefined;
  // Window listeners run after the document's, where the boot listens. jsdom cannot navigate or
  // submit, so the default is stopped there once the result is read. A click the boot holds stops
  // propagating before it gets there.
  const read = (seen: Event) => {
    prevented = seen.defaultPrevented;
    seen.preventDefault();
  };
  window.addEventListener("click", read);
  target.dispatchEvent(event);
  window.removeEventListener("click", read);
  return prevented ?? event.defaultPrevented;
}

afterEach(async () => {
  // Every boot ends released, so its listeners never reach the next test.
  if (started && started.mock.calls.length === 0) {
    document.body.innerHTML = '<a href="/end">end</a>';
    document.querySelector("a")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  }
  // A link click a test left held replays as the load finishes; jsdom cannot follow it.
  const stop = (event: Event) => event.preventDefault();
  window.addEventListener("click", stop);
  finishLoad?.();
  await settle();
  window.removeEventListener("click", stop);
  finishLoad = undefined;
  started = undefined;
  delete (window as QueueWindow).__FARM_PREHYDRATION_CLICK_QUEUE__;
  delete (window as QueueWindow).__FARM_EARLY_NAVIGATION__;
  delete (window as QueueWindow).__FARM_DEPLOYMENT_ID__;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("startFarmIslandsBoot", () => {
  it("holds the same targets and watches with the same margin as the island scheduler", () => {
    expect(FARM_ISLANDS_BOOT_REPLAYABLE_SELECTOR).toBe(FARM_ISLAND_REPLAYABLE_SELECTOR);
    let margin: string | undefined;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(_callback: unknown, options?: IntersectionObserverInit) {
          margin = options?.rootMargin;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const target = document.createElement("div");
    observeIslandVisibility(document, [target], () => {})();
    expect(margin).toBe(FARM_ISLANDS_BOOT_VISIBLE_MARGIN);
  });

  it("loads the runtime at once for an island that hydrates at load", () => {
    const load = boot('<f-island strategy="load"><button type="button">Add</button></f-island>');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads the runtime at once for a boundary the browser has to render", () => {
    const load = boot("<!--$!--><p>fallback</p><!--/$-->");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("waits for an interaction island, then holds its click for the runtime to replay", async () => {
    const load = boot(
      '<f-island strategy="interaction"><button type="button">Add</button></f-island>',
    );
    expect(load).not.toHaveBeenCalled();
    const button = document.querySelector("button")!;
    const announced = vi.fn();
    document.addEventListener("farm:island-interaction", announced);
    const held = click(button);
    document.removeEventListener("farm:island-interaction", announced);
    expect(held).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect((window as QueueWindow).__FARM_PREHYDRATION_CLICK_QUEUE__).toEqual([
      expect.objectContaining({ target: button, kind: "click" }),
    ]);
    expect(announced).toHaveBeenCalledTimes(1);
    // Once the runtime runs, its scheduler holds clicks; the boot lets them through.
    finishLoad!();
    await settle();
    expect(click(button)).toBe(false);
  });

  it("holds every click on an island's control, and a submit button's repeat once", () => {
    boot(
      '<f-island strategy="interaction"><button type="button">Add</button><form><button>Save</button></form></f-island>',
    );
    const [add, save] = Array.from(document.querySelectorAll("button"));
    for (const target of [add!, add!, save!, save!]) expect(click(target)).toBe(true);
    expect(
      (window as QueueWindow).__FARM_PREHYDRATION_CLICK_QUEUE__!.map((item) => item.target),
    ).toEqual([add, add, save]);
  });

  it("leaves clicks and submits outside islands alone, and starts on a form's focus", () => {
    const load = boot(
      '<f-island strategy="interaction"></f-island>' +
        '<form><input name="q"><button type="submit">Search</button></form>',
    );
    const form = document.querySelector("form")!;
    expect(click(document.querySelector("button")!)).toBe(false);
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(false);
    expect(load).not.toHaveBeenCalled();
    document.querySelector("input")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("holds a link click until the runtime runs, then clicks the link again", async () => {
    const load = boot('<f-island strategy="interaction"></f-island><a href="/next">Next</a>');
    const anchor = document.querySelector("a")!;
    const replayed = vi.fn((event: Event) => event.preventDefault());
    expect(click(anchor)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    document.addEventListener("click", replayed);
    finishLoad!();
    await settle();
    document.removeEventListener("click", replayed);
    expect(replayed).toHaveBeenCalledTimes(1);
    expect(replayed.mock.calls[0]![0].target).toBe(anchor);
  });

  it("holds a click on a same-page link in an island, for the island to replay", () => {
    const load = boot(
      '<f-island strategy="interaction"><a href="#usage">Usage</a><a href="/next">Next</a></f-island>',
    );
    const [hash, page] = Array.from(document.querySelectorAll("a"));
    expect(click(hash!)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect((window as QueueWindow).__FARM_PREHYDRATION_CLICK_QUEUE__).toEqual([
      expect.objectContaining({ target: hash, kind: "click" }),
    ]);
    // A link to another page is the router's: held as a link, not queued for the island.
    expect(click(page!)).toBe(true);
    expect((window as QueueWindow).__FARM_PREHYDRATION_CLICK_QUEUE__).toHaveLength(1);
  });

  it("leaves links the router does not take to the browser", () => {
    const load = boot(
      '<f-island strategy="interaction"></f-island>' +
        '<a href="https://example.com/">Out</a><a href="#top">Top</a>' +
        '<a href="/file.pdf" download>File</a><a href="/tab" target="_blank">Tab</a>',
    );
    for (const anchor of Array.from(document.querySelectorAll("a"))) {
      expect(click(anchor)).toBe(false);
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("holds clicks in a root that waits, and starts on its press", () => {
    const load = boot(
      '<script type="module" data-farm-runtime="/r.js" data-farm-root="root" data-farm-root-strategy="interaction"></script>' +
        '<div id="root"><p>Cart: 0</p><button type="button">Add</button><a href="/next">Next</a></div>',
    );
    expect(load).not.toHaveBeenCalled();
    const button = document.querySelector("button")!;
    expect(click(button)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect((window as QueueWindow).__FARM_PREHYDRATION_CLICK_QUEUE__).toEqual([
      expect.objectContaining({ target: button, kind: "click" }),
    ]);
  });

  it("loads the runtime at once for a root that hydrates at load or cannot be found", () => {
    expect(
      boot(
        '<script type="module" data-farm-runtime="/r.js" data-farm-root="root" data-farm-root-strategy="load"></script><div id="root"></div>',
      ),
    ).toHaveBeenCalledTimes(1);
  });

  it("starts loading when a pointer moves over a link", () => {
    const load = boot('<f-island strategy="interaction"></f-island><a href="/next">Next</a>');
    document.querySelector("a")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("the boot's preloads", () => {
  const runtime =
    '<script type="module" data-farm-runtime="/base/farm-client-h1.js" data-farm-preload="chunks/react.js" data-farm-preload-router="chunks/router.js chunks/shared.js" data-farm-preload-root="chunks/theme.js chunks/shared.js"';
  const [react, router, shared, theme] = ["react", "router", "shared", "theme"].map(
    (name) => `/base/chunks/${name}.js`,
  );
  const preloaded = () =>
    Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')).map(
      (link) => new URL(link.href).pathname,
    );
  const hover = (target: Element) =>
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

  afterEach(() => {
    for (const link of Array.from(document.head.querySelectorAll("link"))) link.remove();
  });

  it("fetches nothing before the runtime starts, then the entry's imports and the router for a link", () => {
    boot(
      `${runtime}></script><f-island strategy="interaction"><button>+</button></f-island><a href="/next">Next</a>`,
    );
    const script = document.querySelector<HTMLScriptElement>("script")!;
    script.nonce = "n0nce";
    expect(preloaded()).toEqual([]);
    hover(document.querySelector("a")!);
    expect(preloaded()).toEqual([react, router, shared]);
    const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>("link"));
    expect(links.map((link) => link.nonce)).toEqual(["n0nce", "n0nce", "n0nce"]);
  });

  it("leaves the router for a navigation when an island starts the runtime", () => {
    boot(
      `${runtime}></script><f-island strategy="interaction"><button>+</button></f-island><a href="/next">Next</a>`,
    );
    click(document.querySelector("button")!);
    expect(preloaded()).toEqual([react]);
    // A link's intent while the runtime loads brings the router with it.
    hover(document.querySelector("a")!);
    expect(preloaded()).toEqual([react, router, shared]);
  });

  it("fetches a waiting root's modules for an interaction in it, and the router for a link in it", () => {
    boot(
      `${runtime} data-farm-root="root" data-farm-root-strategy="interaction"></script><div id="root"><button>Toggle</button><a href="/next">Next</a></div><a href="/out">Out</a>`,
    );
    click(document.querySelector("button")!);
    expect(preloaded()).toEqual([react, theme, shared]);
    // A file in two groups is listed twice; the browser fetches a module once.
    hover(document.querySelector('a[href="/next"]')!);
    expect(preloaded()).toEqual([react, theme, shared, router, shared]);
  });

  it("leaves a waiting root's modules for a link in it, whose page swaps in while it waits", () => {
    boot(
      `${runtime} data-farm-root="root" data-farm-root-strategy="interaction"></script><div id="root"><a href="/next">Next</a></div>`,
    );
    hover(document.querySelector("a")!);
    expect(preloaded()).toEqual([react, router, shared]);
  });

  it("fetches each group once", () => {
    boot(`${runtime}></script><a href="/a">A</a><a href="/b">B</a>`);
    for (const link of Array.from(document.querySelectorAll("a"))) hover(link);
    expect(preloaded()).toEqual([react, router, shared]);
  });

  describe("of the renderer (RFC 0010)", () => {
    const withRenderer = `${runtime} data-farm-preload-renderer="chunks/react-dom.js"`;
    const reactDom = "/base/chunks/react-dom.js";

    it("leaves it to the entry for a link whose page streams, and fetches it for an island", () => {
      boot(
        `${withRenderer}></script><f-island strategy="interaction"><button>+</button></f-island><a href="/next">Next</a>`,
      );
      hover(document.querySelector("a")!);
      expect(preloaded()).toEqual([react, router, shared]);
      click(document.querySelector("button")!);
      expect(preloaded()).toEqual([react, router, shared, reactDom]);
    });

    it("fetches it with the entry when an island starts the runtime on its own trigger", () => {
      boot(`${withRenderer}></script><f-island strategy="load"><button>+</button></f-island>`);
      expect(preloaded()).toEqual([react, reactDom]);
    });

    it("leaves it for a link in a root that waits, and fetches it for an interaction there", () => {
      boot(
        `${withRenderer} data-farm-root="root" data-farm-root-strategy="interaction"></script><div id="root"><a href="/next">Next</a><button>Toggle</button></div>`,
      );
      hover(document.querySelector("a")!);
      expect(preloaded()).not.toContain(reactDom);
      click(document.querySelector("button")!);
      expect(preloaded()).toContain(reactDom);
    });
  });
});

describe("the boot's request for a held link click", () => {
  const early = () => (window as QueueWindow).__FARM_EARLY_NAVIGATION__;

  it("sends the router's deployment header", () => {
    expect(FARM_ISLANDS_BOOT_DEPLOYMENT_HEADER).toBe(FARM_DEPLOYMENT_ID_HEADER);
  });

  it("requests the page with the click, with the headers the router sends for it", () => {
    (window as QueueWindow).__FARM_DEPLOYMENT_ID__ = "d1";
    boot(
      '<div id="root"><div data-farm-layout-boundary="true" data-farm-layout-pattern="/docs" data-farm-layout-key="/docs"><a href="/docs/b#top">B</a></div></div>',
    );
    expect(pageRequests).not.toHaveBeenCalled();
    click(document.querySelector("a")!);
    expect(pageRequests).toHaveBeenCalledTimes(1);
    const [url, init] = pageRequests.mock.calls[0]!;
    expect(url).toBe(new URL("/docs/b#top", document.baseURI).href);
    expect(init.redirect).toBe("manual");
    // The layouts shown and flush markers, as a navigation the router streams; no held values.
    expect(init.headers).toEqual({
      accept: "text/html",
      "x-farm-deployment-id": "d1",
      "f-layouts": '["/docs"]',
      "f-stream": "flush",
    });
    expect(early()).toMatchObject({ url, headers: init.headers });
    expect(early()!.response).toBe(pageRequests.mock.results[0]!.value);
  });

  it("asks for the whole page when the page's layout hydrates as one root", () => {
    boot(
      '<script type="module" data-farm-runtime="/farm-client-h1.js" data-farm-root="root" data-farm-root-strategy="interaction"></script><div id="root"><a href="/shop/b">B</a></div>',
    );
    click(document.querySelector("a")!);
    // The router swaps such a page in while the root waits, and asks for it whole (RFC 0011).
    expect(pageRequests.mock.calls[0]![1].headers).toEqual({ accept: "text/html" });
  });

  it("requests the page of the last click when two are held", () => {
    boot('<a href="/a">A</a><a href="/b">B</a>');
    const [a, b] = Array.from(document.querySelectorAll("a"));
    click(a!);
    click(b!);
    expect(early()!.url).toBe(new URL("/b", document.baseURI).href);
    expect(early()!.response).toBe(pageRequests.mock.results[1]!.value);
  });

  it("requests nothing for a hover, a link the router does not take, or once the runtime runs", async () => {
    boot(
      '<a href="/next">Next</a><a href="https://example.com/">Out</a><a href="/file" download>File</a>',
    );
    const [next, out, file] = Array.from(document.querySelectorAll("a"));
    next!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    click(out!);
    click(file!);
    expect(pageRequests).not.toHaveBeenCalled();
    finishLoad!();
    await settle();
    click(next!);
    expect(pageRequests).not.toHaveBeenCalled();
  });
});
