// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createRouteDataCacheKey } from "../cache";
import { getFarmClientDataCache } from "../client-cache";
import type { ServerQuery } from "../server-query";
import {
  beginFarmServerQueryAction,
  completeFarmServerQueryAction,
  fetchServerQuery,
} from "../server-query-runtime";
import { createFarmServerQueryResult } from "../server-query-protocol";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const key = createRouteDataCacheKey(["product", "shared"]);
function transported(handler: () => Promise<string>, timestamp = 10, canonical = key) {
  return (async () => {
    const invocation = beginFarmServerQueryAction("product", []);
    const value = await handler();
    return completeFarmServerQueryAction(
      invocation,
      createFarmServerQueryResult(value, {
        key: canonical,
        updatedAt: timestamp,
        staleTime: false,
      }),
    );
  }) as ServerQuery<void, string>;
}
afterEach(() => getFarmClientDataCache().clear());

it.each(["older-first", "newer-first"])(
  "orders two newly learned canonical aliases with %s completion",
  async (order) => {
    const old = deferred<string>();
    const newer = deferred<string>();
    const oldQuery = transported(() => old.promise);
    const newQuery = transported(() => newer.promise);
    const first = fetchServerQuery(oldQuery, undefined, { force: true });
    const second = fetchServerQuery(newQuery, undefined, { force: true });
    if (order === "older-first") {
      old.resolve("old");
      await first;
      newer.resolve("new");
      await second;
    } else {
      newer.resolve("new");
      await second;
      old.resolve("old");
      await first;
    }
    expect(await first).toBe("old");
    expect(await second).toBe("new");
    expect(getFarmClientDataCache().get(key)?.data).toBe("new");
    expect(await fetchServerQuery(oldQuery, undefined)).toBe("new");
  },
);

it.each(["success", "error"])(
  "preserves a newer %s after both aliases are already known",
  async (outcome) => {
    let oldHandler = async () => "seed";
    let newHandler = async () => "seed";
    const oldQuery = transported(() => oldHandler());
    const newQuery = transported(() => newHandler());
    await fetchServerQuery(oldQuery, undefined, { force: true });
    await fetchServerQuery(newQuery, undefined, { force: true });
    const old = deferred<string>();
    const newer = deferred<string>();
    oldHandler = () => old.promise;
    newHandler = () => newer.promise;
    const first = fetchServerQuery(oldQuery, undefined, { force: true });
    const second = fetchServerQuery(newQuery, undefined, { force: true });
    if (outcome === "error") {
      const failure = new Error("new request failed");
      newer.reject(failure);
      await expect(second).rejects.toBe(failure);
    } else {
      newer.resolve("new");
      await second;
    }
    const expected = getFarmClientDataCache().get(key);
    old.resolve("old");
    await first;
    expect(getFarmClientDataCache().get(key)).toBe(expected);
  },
);

it.each(["success", "error"])(
  "ignores old %s without stranding a newer pending read",
  async (outcome) => {
    let oldHandler = async () => "seed";
    let newHandler = async () => "seed";
    const oldQuery = transported(() => oldHandler());
    const newQuery = transported(() => newHandler());
    await fetchServerQuery(oldQuery, undefined, { force: true });
    await fetchServerQuery(newQuery, undefined, { force: true });
    const old = deferred<string>();
    const newer = deferred<string>();
    oldHandler = () => old.promise;
    newHandler = () => newer.promise;
    const first = fetchServerQuery(oldQuery, undefined, { force: true });
    const second = fetchServerQuery(newQuery, undefined, { force: true });
    if (outcome === "error") {
      old.reject(new Error("old failure"));
      await expect(first).rejects.toThrow("old failure");
    } else {
      old.resolve("old");
      await first;
    }
    try {
      expect(getFarmClientDataCache().get(key)?.fetching).toBe(true);
      expect(getFarmClientDataCache().get(key)?.error).toBeNull();
    } finally {
      newer.resolve("new");
      await second;
    }
    expect(getFarmClientDataCache().get(key)?.data).toBe("new");
  },
);

it("does not let a superseded reference re-invalidate a newer canonical result", async () => {
  const old = deferred<string>();
  const first = fetchServerQuery(
    transported(() => old.promise),
    undefined,
  );
  getFarmClientDataCache().invalidate(key);
  await fetchServerQuery(
    transported(async () => "new", Date.now()),
    undefined,
    { force: true },
  );
  expect(getFarmClientDataCache().isStale(key)).toBe(false);
  old.resolve("old");
  await first;
  expect(getFarmClientDataCache().isStale(key)).toBe(false);
  expect(getFarmClientDataCache().get(key)?.data).toBe("new");
});

it("does not supersede unrelated keys or retain ownership after requests finish", async () => {
  const otherKey = createRouteDataCacheKey(["product", "other"]);
  const slow = deferred<string>();
  const first = fetchServerQuery(
    transported(() => slow.promise),
    undefined,
    { force: true },
  );
  await fetchServerQuery(
    transported(async () => "other", 10, otherKey),
    undefined,
    { force: true },
  );
  slow.resolve("old");
  await first;
  expect(getFarmClientDataCache().get(key)?.data).toBe("old");
  expect(getFarmClientDataCache().get(otherKey)?.data).toBe("other");
  getFarmClientDataCache().clear();
  await fetchServerQuery(
    transported(async () => "after-clear"),
    undefined,
    { force: true },
  );
  expect(getFarmClientDataCache().get(key)?.data).toBe("after-clear");
});
