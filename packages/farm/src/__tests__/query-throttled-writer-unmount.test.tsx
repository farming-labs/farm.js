// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { asString, useQueryState, useQueryStates } from "../query/client";

let root: ReturnType<typeof createRoot> | undefined;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/");
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it("reverts a peer's adopted draft when a throttled useQueryState writer unmounts before it commits", async () => {
  window.history.replaceState(null, "", "/?q=original");

  let readerValue!: string | null;
  let write!: (q: string) => void;

  function Reader() {
    const [q] = useQueryState("q", asString);
    readerValue = q;
    return null;
  }
  function Writer() {
    const [, setQ] = useQueryState("q", asString, { throttleMs: 100 });
    write = setQ;
    return null;
  }

  root = createRoot(document.createElement("div"));
  const render = (showWriter: boolean) =>
    root!.render(
      createElement("div", null, createElement(Reader), showWriter && createElement(Writer)),
    );

  await act(async () => render(true));
  expect(readerValue).toBe("original");

  // Writer optimistically broadcasts "draft"; the reader adopts it. The URL
  // write is throttled (not yet committed).
  await act(async () => write("draft"));
  expect(readerValue).toBe("draft");

  // Writer unmounts before the throttle fires -> its queued write is cancelled.
  await act(async () => render(false));
  await act(async () => {
    vi.advanceTimersByTime(200);
  });

  // The URL was correctly left untouched (write cancelled)...
  expect(window.location.search).toBe("?q=original");
  // ...and the reader must not durably display a value that never reached the
  // URL and has no owner to reconcile it.
  expect(readerValue).toBe("original");
});

it("reverts a peer's adopted draft when a throttled useQueryStates writer unmounts before it commits", async () => {
  window.history.replaceState(null, "", "/?q=original");

  let readerValue!: string | null;
  let write!: (q: string) => void;

  function Reader() {
    const [q] = useQueryState("q", asString);
    readerValue = q;
    return null;
  }
  function Writer() {
    const [, set] = useQueryStates({ q: asString }, { throttleMs: 100 });
    write = (q) => set({ q });
    return null;
  }

  root = createRoot(document.createElement("div"));
  const render = (showWriter: boolean) =>
    root!.render(
      createElement("div", null, createElement(Reader), showWriter && createElement(Writer)),
    );

  await act(async () => render(true));
  expect(readerValue).toBe("original");

  await act(async () => write("draft"));
  expect(readerValue).toBe("draft");

  await act(async () => render(false));
  await act(async () => {
    vi.advanceTimersByTime(200);
  });

  expect(window.location.search).toBe("?q=original");
  expect(readerValue).toBe("original");
});
