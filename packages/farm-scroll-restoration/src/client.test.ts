import { afterEach, describe, expect, it, vi } from "vitest";
import { startScrollRestorationRuntime } from "./client.js";
import { SCROLL_ENTRY_STATE_KEY } from "./policy.js";
import type { ScrollRestorationNavigationEvent, ScrollRestorationRuntime } from "./types.js";

const PREFIX = "farm-scroll-restore";
let sequence = 0;

function navigation(
  action: ScrollRestorationNavigationEvent["action"],
  to: string,
): ScrollRestorationNavigationEvent {
  const url = new URL(to, "http://localhost");
  return {
    id: `navigation:${++sequence}`,
    to: { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash },
    action,
  };
}

/**
 * A tab with its own session history. Pushes copy the current entry's state
 * into the new one, as core's production router does, so tests catch an id
 * that leaks from one entry into the next.
 */
function createTab(startPath = "/", startState: unknown = null) {
  const entries: { url: URL; state: unknown }[] = [
    { url: new URL(startPath, "http://localhost"), state: startState },
  ];
  let index = 0;
  const storage = new Map<string, string>();
  const scrollTo = vi.fn();
  const tab = {
    scrollX: 0,
    scrollY: 0,
    scrollTo,
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
    get location() {
      return entries[index]!.url;
    },
    history: {
      get state() {
        return entries[index]!.state;
      },
      replaceState(state: unknown, _unused: string, url?: string) {
        const entry = entries[index]!;
        entries[index] = {
          url: url ? new URL(url, entry.url) : entry.url,
          state: structuredClone(state),
        };
      },
    },
  };
  let runtime: ScrollRestorationRuntime | null = null;

  return {
    tab,
    storage,
    scrollTo,
    entries,
    /** Start the plugin runtime, as on page load or reload. */
    start(): ScrollRestorationRuntime {
      runtime = startScrollRestorationRuntime(
        { storageKeyPrefix: PREFIX },
        tab as unknown as Window & typeof globalThis,
      );
      return runtime;
    },
    scroll(y: number) {
      tab.scrollY = y;
    },
    /** A link click: the hooks run around the router's pushState. */
    push(path: string) {
      const event = navigation("push", path);
      runtime?.saveForNavigation(event);
      const state = structuredClone(entries[index]!.state);
      entries.splice(index + 1);
      entries.push({ url: new URL(path, "http://localhost"), state });
      index += 1;
      runtime?.enterForNavigation(event);
      runtime?.restoreForNavigation(event);
    },
    replace(path: string) {
      const event = navigation("replace", path);
      runtime?.saveForNavigation(event);
      entries[index] = {
        url: new URL(path, "http://localhost"),
        state: structuredClone(entries[index]!.state),
      };
      runtime?.enterForNavigation(event);
      runtime?.restoreForNavigation(event);
    },
    /**
     * Back or Forward: the browser moves first, then the router runs the
     * hooks. `rendered: false` is a traversal that a newer one overtook, for
     * which core skips `navigation.rendered`.
     */
    traverse(delta: number, { rendered = true } = {}) {
      index += delta;
      const event = navigation("pop", entries[index]!.url.href);
      runtime?.saveForNavigation(event);
      runtime?.enterForNavigation(event);
      if (rendered) runtime?.restoreForNavigation(event);
    },
    close() {
      runtime?.close();
    },
  };
}

describe("startScrollRestorationRuntime", () => {
  const tabs: Array<ReturnType<typeof createTab>> = [];

  function tabAt(path = "/", state: unknown = null) {
    const created = createTab(path, state);
    tabs.push(created);
    return created;
  }

  afterEach(() => {
    for (const tab of tabs.splice(0)) tab.close();
  });

  it("saves the entry being left on navigation.before", () => {
    const tab = tabAt("/");
    tab.start();
    const id = (tab.tab.history.state as Record<string, string>)[SCROLL_ENTRY_STATE_KEY];
    tab.scroll(300);
    tab.push("/about");

    expect(tab.storage.get(`${PREFIX}:${id}`)).toBe('{"x":0,"y":300}');
  });

  it("restores the first page the tab loaded on Back", () => {
    const tab = tabAt("/posts/7");
    tab.start();
    tab.scroll(900);
    tab.push("/about");
    tab.traverse(-1);

    expect(tab.scrollTo).toHaveBeenLastCalledWith(0, 900);
  });

  it("restores the page being left on Forward", () => {
    const tab = tabAt("/");
    tab.start();
    tab.scroll(1200);
    tab.push("/about");
    tab.scroll(300);
    tab.traverse(-1);
    expect(tab.scrollTo).toHaveBeenLastCalledWith(0, 1200);

    tab.traverse(1);
    expect(tab.scrollTo).toHaveBeenLastCalledWith(0, 300);
  });

  it("keeps two positions when the same URL is in history twice", () => {
    const tab = tabAt("/");
    tab.start();
    tab.scroll(1200);
    tab.push("/about");
    tab.scroll(0);
    tab.push("/");
    tab.scroll(50);
    tab.traverse(-1);
    tab.traverse(-1);

    expect(tab.scrollTo).toHaveBeenLastCalledWith(0, 1200);
    tab.traverse(2);
    expect(tab.scrollTo).toHaveBeenLastCalledWith(0, 50);
  });

  it("saves under the right entry when a second Back overtakes the first", () => {
    const tab = tabAt("/");
    tab.start();
    tab.scroll(1200);
    tab.push("/about");
    tab.scroll(0);
    tab.push("/");
    tab.scroll(300);
    tab.traverse(-1, { rendered: false });
    tab.traverse(-1);
    expect(tab.scrollTo).toHaveBeenLastCalledWith(0, 1200);

    tab.traverse(1, { rendered: false });
    tab.traverse(1);
    expect(tab.scrollTo).toHaveBeenLastCalledWith(0, 300);
  });

  it("does not restore when the rendered event belongs to another navigation", () => {
    const tab = tabAt("/");
    const runtime = tab.start();
    tab.scroll(1200);
    tab.push("/about");
    tab.traverse(-1, { rendered: false });
    runtime.restoreForNavigation(navigation("pop", "/"));

    expect(tab.scrollTo).not.toHaveBeenCalled();
  });

  it("keeps a position per query string", () => {
    const tab = tabAt("/search?q=a");
    tab.start();
    tab.scroll(800);
    tab.push("/search?q=b");
    tab.scroll(300);
    tab.traverse(-1);

    expect(tab.scrollTo).toHaveBeenLastCalledWith(0, 800);
  });

  it("gives every pushed entry its own id even when the router copies state", () => {
    const tab = tabAt("/");
    tab.start();
    tab.push("/about");
    tab.push("/contact");
    const ids = tab.entries.map(
      (entry) => (entry.state as Record<string, string>)[SCROLL_ENTRY_STATE_KEY],
    );

    expect(new Set(ids).size).toBe(3);
  });

  it("keeps the router's own history state when it adds its id", () => {
    const tab = tabAt("/", { path: "/", __farmHistoryIndex: 0 });
    tab.start();

    expect(tab.tab.history.state).toMatchObject({ path: "/", __farmHistoryIndex: 0 });
    expect(tab.tab.history.state).toHaveProperty(SCROLL_ENTRY_STATE_KEY);
  });

  it("keeps the entry's id across a reload", () => {
    const tab = tabAt("/");
    const first = tab.start();
    const id = (tab.tab.history.state as Record<string, string>)[SCROLL_ENTRY_STATE_KEY];
    first.close();
    tab.start();

    expect((tab.tab.history.state as Record<string, string>)[SCROLL_ENTRY_STATE_KEY]).toBe(id);
  });

  it("does not restore for push or replace navigations", () => {
    const tab = tabAt("/");
    tab.start();
    tab.scroll(420);
    tab.push("/posts/7");
    tab.replace("/posts/8");

    expect(tab.scrollTo).not.toHaveBeenCalled();
  });

  it("leaves a destination hash to core", () => {
    const tab = tabAt("/posts/7#comments");
    tab.start();
    tab.scroll(420);
    tab.push("/about");
    tab.traverse(-1);

    expect(tab.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing on Back to an entry without an id", () => {
    const tab = tabAt("/");
    tab.start();
    tab.push("/about");
    // A router that replaces the whole state drops the id.
    tab.entries[0]!.state = { path: "/" };
    tab.traverse(-1);

    expect(tab.scrollTo).not.toHaveBeenCalled();
  });

  it("stops saving and restoring after close", () => {
    const tab = tabAt("/");
    tab.start();
    tab.scroll(300);
    tab.push("/about");
    const saved = tab.storage.size;
    tab.close();
    tab.scroll(100);
    tab.traverse(-1);

    expect(tab.storage.size).toBe(saved);
    expect(tab.scrollTo).not.toHaveBeenCalled();
  });

  it("never throws when history, storage or scrollTo is hostile", () => {
    const hostileWindow = {
      location: new URL("http://localhost/"),
      scrollX: 0,
      scrollY: 120,
      scrollTo() {
        throw new Error("denied");
      },
      get history(): never {
        throw new Error("denied");
      },
      get sessionStorage(): never {
        throw new Error("denied");
      },
    } as unknown as Window & typeof globalThis;
    const hostile = startScrollRestorationRuntime({ storageKeyPrefix: PREFIX }, hostileWindow);

    const push = navigation("push", "/about");
    const pop = navigation("pop", "/");
    expect(() => hostile.saveForNavigation(push)).not.toThrow();
    expect(() => hostile.enterForNavigation(push)).not.toThrow();
    expect(() => hostile.restoreForNavigation(push)).not.toThrow();
    expect(() => hostile.enterForNavigation(pop)).not.toThrow();
    expect(() => hostile.restoreForNavigation(pop)).not.toThrow();
    hostile.close();
  });
});
