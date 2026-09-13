// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FarmClientDataCache,
  getFarmClientDataCache,
  trackFarmClientCacheInvalidations,
} from "../client-cache";
import { notifyFarmCacheInvalidation } from "../cache-invalidation";
import type { ServerQuery } from "../server-query";
import {
  beginFarmServerQueryAction,
  completeFarmServerQueryAction,
  createServerQueryCallKey,
  fetchServerQuery,
} from "../server-query-runtime";
import { useServerQuery } from "../server-query-client";
import { createFarmServerQueryResult } from "../server-query-protocol";

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function transported(handler: () => string | Promise<string>): ServerQuery<undefined, string> {
  return Object.assign(
    async () => {
      const invocation = beginFarmServerQueryAction("inflight-query", []);
      const data = await handler();
      return completeFarmServerQueryAction(
        invocation,
        createFarmServerQueryResult(data, {
          key: "query:canonical",
          staleTime: false,
          updatedAt: Date.now(),
        }),
      );
    },
    { __farmServerQuery: true as const },
  );
}
beforeEach(() => {
  getFarmClientDataCache().clear();
});
afterEach(() => {
  getFarmClientDataCache().clear();
  vi.restoreAllMocks();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

it.each([
  { knownAlias: false, sameTick: false },
  { knownAlias: false, sameTick: true },
  { knownAlias: true, sameTick: false },
  { knownAlias: true, sameTick: true },
])(
  "preserves in-flight invalidation ($knownAlias, same tick $sameTick)",
  async ({ knownAlias, sameTick }) => {
    let now = 100;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const old = deferred();
    let calls = 0;
    const query = transported(() => {
      ++calls;
      return knownAlias && calls === 1
        ? "initial"
        : calls === (knownAlias ? 2 : 1)
          ? old.promise
          : "new";
    });
    if (knownAlias) await fetchServerQuery(query, undefined);
    const pending = fetchServerQuery(query, undefined, { force: true });
    await Promise.resolve();
    if (!sameTick) now = 200;
    notifyFarmCacheInvalidation("query:canonical");
    now = 300;
    old.resolve("old");
    expect(await pending).toBe("old");
    expect(getFarmClientDataCache().isStale("query:canonical")).toBe(true);
    expect(await fetchServerQuery(query, undefined, { swr: false })).toBe("new");
    expect(getFarmClientDataCache().isStale("query:canonical")).toBe(false);
  },
);

it("also protects plain-data transports and direct cache invalidation", async () => {
  const old = deferred();
  let calls = 0;
  const query = Object.assign(async () => (++calls === 1 ? old.promise : "new"), {
    __farmServerQuery: true as const,
  });
  const key = createServerQueryCallKey(query, undefined);
  const pending = fetchServerQuery(query, undefined, { staleTime: false });
  await Promise.resolve();
  getFarmClientDataCache().invalidate(key);
  old.resolve("old");
  await pending;
  expect(await fetchServerQuery(query, undefined, { staleTime: false, swr: false })).toBe("new");
});

it("ignores invalidations before startup and unrelated keys", async () => {
  notifyFarmCacheInvalidation("query:canonical");
  const data = deferred();
  const query = transported(() => data.promise);
  const pending = fetchServerQuery(query, undefined);
  notifyFarmCacheInvalidation("unrelated");
  data.resolve("fresh");
  await pending;
  expect(getFarmClientDataCache().isStale("query:canonical")).toBe(false);
});

it("does not let an invalidated older owner re-invalidate a newer forced result", async () => {
  const old = deferred();
  let calls = 0;
  const query = transported(() => (++calls === 1 ? old.promise : "new"));
  const pending = fetchServerQuery(query, undefined);
  await Promise.resolve();
  notifyFarmCacheInvalidation("query:canonical");
  expect(await fetchServerQuery(query, undefined, { force: true })).toBe("new");
  old.resolve("old");
  await pending;
  expect(getFarmClientDataCache().isStale("query:canonical")).toBe(false);
  expect(await fetchServerQuery(query, undefined)).toBe("new");
  expect(calls).toBe(2);
});

it("refreshes mounted consumers once after invalidated first work finishes", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const old = deferred();
  let calls = 0;
  const query = transported(() => (++calls === 1 ? old.promise : "new"));
  function View() {
    const result = useServerQuery(query, undefined);
    return createElement("span", null, result.data);
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement("div", null, createElement(View), createElement(View))),
    );
    expect(calls).toBe(1);
    await act(async () => notifyFarmCacheInvalidation("query:canonical"));
    await act(async () => old.resolve("old"));
    expect(calls).toBe(2);
    expect(container.textContent).toBe("newnew");
  } finally {
    await act(async () => root.unmount());
    old.resolve("cleanup");
  }
});

it("releases invalidation tracking and resolves aliases learned after invalidation", () => {
  const cache = new FarmClientDataCache({ subscribeToInvalidation: false });
  const other = new FarmClientDataCache({ subscribeToInvalidation: false });
  const tracked = trackFarmClientCacheInvalidations(cache);
  try {
    other.invalidate("canonical");
    expect(tracked.has("canonical")).toBe(false);
    cache.invalidate("provisional");
    cache.alias("provisional", "canonical");
    expect(tracked.has("canonical")).toBe(true);
    // A newer cache write may consume the timestamp, but not this read's history.
    cache.set("canonical", { data: "new", updatedAt: Date.now() + 1, staleAt: Infinity });
    expect(tracked.has("canonical")).toBe(true);
    tracked.dispose();
    cache.invalidate("canonical");
    expect(tracked.has("canonical")).toBe(false);
  } finally {
    tracked.dispose();
    cache.dispose();
    other.dispose();
  }
});
