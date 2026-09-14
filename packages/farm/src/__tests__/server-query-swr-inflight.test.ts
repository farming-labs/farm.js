// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { getFarmClientDataCache } from "../client-cache";
import type { ServerQuery } from "../server-query";
import { createServerQueryCallKey, fetchServerQuery } from "../server-query-runtime";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => getFarmClientDataCache().clear());

it.each(["cached", undefined])(
  "returns stale %s to every SWR reader during one refresh",
  async (data) => {
    const gate = deferred<string>();
    const started = deferred<void>();
    const handler = vi.fn(() => {
      started.resolve();
      return gate.promise;
    });
    const query = handler as unknown as ServerQuery<void, string | undefined>;
    const cache = getFarmClientDataCache();
    const key = createServerQueryCallKey(query, undefined);
    cache.set(key, { data, updatedAt: 1, staleAt: 0, status: "success" });
    expect(await fetchServerQuery(query, undefined)).toBe(data);
    await started.promise;
    const received: unknown[] = [];
    const second = fetchServerQuery(query, undefined).then((value) => received.push(value));
    const third = fetchServerQuery(query, undefined).then((value) => received.push(value));
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(received).toEqual([data, data]);
      expect(handler).toHaveBeenCalledOnce();
    } finally {
      gate.resolve("fresh");
      await Promise.all([second, third, cache.getInflight(key)]);
    }
    expect(cache.get(key)?.data).toBe("fresh");
  },
);

it.each(["empty", "swr-disabled", "force"] as const)("keeps %s reads blocking", async (mode) => {
  const gates = [deferred<string>(), deferred<string>()];
  let calls = 0;
  const handler = vi.fn(() => gates[calls++].promise);
  const query = handler as unknown as ServerQuery<void, string>;
  const key = createServerQueryCallKey(query, undefined);
  const cache = getFarmClientDataCache();
  if (mode !== "empty")
    cache.set(key, { data: "cached", updatedAt: 1, staleAt: 0, status: "success" });
  const first = fetchServerQuery(query, undefined);
  let settled = false;
  const second = fetchServerQuery(
    query,
    undefined,
    mode === "force" ? { force: true } : { swr: false },
  ).then((value) => {
    settled = true;
    return value;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(handler).toHaveBeenCalledTimes(mode === "force" ? 2 : 1);
  } finally {
    gates[0].resolve("fresh");
    gates[1].resolve("forced");
    await first;
  }
  expect(await second).toBe(mode === "force" ? "forced" : "fresh");
});
