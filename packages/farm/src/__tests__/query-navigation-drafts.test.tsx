// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { asString, useQueryState, useQueryStates } from "../query/client";
import { FARM_HISTORY_CHANGE_EVENT } from "../client/history-sync";

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/search?q=original");
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

const destinations = ["/other?q=actual", "/search?q=actual", "/search?q=original#section"];
for (const kind of ["single", "multiple"] as const) {
  it.each(destinations)(
    `discards ${kind} layout drafts when navigating to %s`,
    async (destination) => {
      let value: string | null = null;
      let update!: (q: string) => void;
      function Single() {
        [value, update] = useQueryState("q", asString, { throttleMs: 100 });
        return null;
      }
      function Multiple() {
        const [state, set] = useQueryStates({ q: asString }, { throttleMs: 100 });
        value = state.q;
        update = (q) => set({ q });
        return null;
      }
      await act(async () =>
        root.render(
          createElement(StrictMode, null, createElement(kind === "single" ? Single : Multiple)),
        ),
      );
      await act(async () => update("draft"));
      await act(async () => {
        window.history.pushState(null, "", destination);
        window.dispatchEvent(new CustomEvent(FARM_HISTORY_CHANGE_EVENT));
      });
      expect(value).toBe(new URL(destination, window.location.origin).searchParams.get("q"));
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(window.location.pathname + window.location.search + window.location.hash).toBe(
        destination,
      );
      expect(value).toBe(new URL(destination, window.location.origin).searchParams.get("q"));
    },
  );
}

it.each(["popstate", FARM_HISTORY_CHANGE_EVENT])(
  "does not resurrect a departed draft after returning to its URL (%s)",
  async (event) => {
    let value: string | null = null;
    let update!: (q: string) => void;
    function Layout() {
      [value, update] = useQueryState("q", asString, { throttleMs: 100 });
      return null;
    }
    await act(async () => root.render(createElement(Layout)));
    await act(async () => update("draft"));
    await act(async () => {
      window.history.replaceState(null, "", "/other?q=actual");
      window.dispatchEvent(new Event(event));
      window.history.replaceState(null, "", "/search?q=original");
      window.dispatchEvent(new Event(event));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(window.location.search).toBe("?q=original");
    expect(value).toBe("original");
  },
);

it("checks the owning URL before committing even without a history notification", async () => {
  let update!: (q: string) => void;
  function Layout() {
    [, update] = useQueryState("q", asString, { throttleMs: 100 });
    return null;
  }
  await act(async () => root.render(createElement(Layout)));
  await act(async () => update("draft"));
  window.history.replaceState(null, "", "/other?q=actual");
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
  expect(window.location.pathname + window.location.search).toBe("/other?q=actual");
});

it("preserves sibling drafts across Farm query commits and accepts fresh edits after navigation", async () => {
  let q: string | null = null;
  let page: string | null = null;
  let setQ!: (q: string) => void;
  let setPage!: (page: string) => void;
  function Layout() {
    [q, setQ] = useQueryState("q", asString, { throttleMs: 100 });
    [page, setPage] = useQueryState("page", asString, { throttleMs: 200 });
    return null;
  }
  await act(async () => root.render(createElement(Layout)));
  await act(async () => {
    setQ("farm");
    setPage("2");
  });
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(window.location.search).toBe("?q=farm");
  expect(page).toBe("2");
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(window.location.search).toBe("?q=farm&page=2");
  await act(async () => {
    window.history.replaceState(null, "", "/other?q=actual");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await act(async () => setQ("fresh"));
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
  expect(q).toBe("fresh");
  expect(window.location.pathname + window.location.search).toBe("/other?q=fresh");
});
