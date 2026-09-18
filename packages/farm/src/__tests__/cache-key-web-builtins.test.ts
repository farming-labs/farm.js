import { afterEach, describe, expect, it } from "vitest";
import {
  configureFarmCache,
  createFarmCacheKey,
  FarmDataCache,
  storageCacheAdapter,
  unstable_cache,
  type FarmCacheStorage,
} from "../cache";

afterEach(() => {
  configureFarmCache(undefined);
});

describe("createFarmCacheKey with URLSearchParams and Headers", () => {
  it("gives different keys to URLSearchParams with different contents", () => {
    expect(createFarmCacheKey([new URLSearchParams("a=1")])).toBe('[urlsearchparams:[["a","1"]]]');
    expect(createFarmCacheKey([new URLSearchParams("b=2")])).toBe('[urlsearchparams:[["b","2"]]]');
    expect(createFarmCacheKey([new URLSearchParams()])).toBe("[urlsearchparams:[]]");
  });

  it("gives different keys to Headers with different contents", () => {
    expect(createFarmCacheKey([new Headers({ "x-auth": "token-1" })])).toBe(
      '[headers:[["x-auth","token-1"]]]',
    );
    expect(createFarmCacheKey([new Headers({ "x-auth": "token-2" })])).toBe(
      '[headers:[["x-auth","token-2"]]]',
    );
    expect(createFarmCacheKey([new Headers()])).toBe("[headers:[]]");
  });

  it("does not collapse URLSearchParams or Headers contents to an empty object", () => {
    expect(createFarmCacheKey([new URLSearchParams("a=1")])).not.toBe(createFarmCacheKey([{}]));
    expect(createFarmCacheKey([new Headers({ a: "1" })])).not.toBe(createFarmCacheKey([{}]));
    expect(createFarmCacheKey([new URLSearchParams("a=1")])).not.toBe(
      createFarmCacheKey([new URLSearchParams("b=2")]),
    );
    expect(createFarmCacheKey([new Headers({ "x-auth": "t1" })])).not.toBe(
      createFarmCacheKey([new Headers({ "x-auth": "t2" })]),
    );
  });

  it("does not confuse URLSearchParams, Headers, a Map, an array, an object and an empty object", () => {
    const keys = [
      createFarmCacheKey([new URLSearchParams("a=a")]),
      createFarmCacheKey([new Headers({ a: "a" })]),
      createFarmCacheKey([new Map([["a", "a"]])]),
      createFarmCacheKey([["a", "a"]]),
      createFarmCacheKey([{ a: "a" }]),
      createFarmCacheKey([{}]),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives the same key to equivalent contents in a different insertion order", () => {
    expect(createFarmCacheKey([new URLSearchParams("b=2&a=1")])).toBe(
      createFarmCacheKey([new URLSearchParams("a=1&b=2")]),
    );

    const h1 = new Headers();
    h1.append("b", "2");
    h1.append("a", "1");
    const h2 = new Headers();
    h2.append("a", "1");
    h2.append("b", "2");
    expect(createFarmCacheKey([h1])).toBe(createFarmCacheKey([h2]));
  });

  it("distinguishes repeated parameter/header names by value", () => {
    expect(createFarmCacheKey([new URLSearchParams("a=1&a=2")])).toBe(
      '[urlsearchparams:[["a","1"],["a","2"]]]',
    );
    expect(createFarmCacheKey([new URLSearchParams("a=1&a=2")])).not.toBe(
      createFarmCacheKey([new URLSearchParams("a=1")]),
    );

    const cookies = new Headers();
    cookies.append("set-cookie", "a=1");
    cookies.append("set-cookie", "b=2");
    expect(createFarmCacheKey([cookies])).toBe(
      '[headers:[["set-cookie","a=1"],["set-cookie","b=2"]]]',
    );
    expect(createFarmCacheKey([cookies])).not.toBe(createFarmCacheKey([{}]));
  });

  it("preserves the order of repeated URLSearchParams values", () => {
    const firstThenSecond = createFarmCacheKey([new URLSearchParams("a=1&a=2&b=3")]);
    const secondThenFirst = createFarmCacheKey([new URLSearchParams("b=3&a=2&a=1")]);

    expect(firstThenSecond).toBe('[urlsearchparams:[["a","1"],["a","2"],["b","3"]]]');
    expect(secondThenFirst).toBe('[urlsearchparams:[["a","2"],["a","1"],["b","3"]]]');
    expect(firstThenSecond).not.toBe(secondThenFirst);
  });

  it("serializes URLSearchParams and Headers nested inside other structures", () => {
    expect(
      createFarmCacheKey([
        { params: new URLSearchParams("a=1"), headers: new Headers({ b: "2" }) },
      ]),
    ).toBe('[{"headers":headers:[["b","2"]],"params":urlsearchparams:[["a","1"]]}]');
  });

  it("caches unstable_cache calls separately per URLSearchParams contents", async () => {
    let calls = 0;
    const search = unstable_cache(
      async (params: URLSearchParams) => {
        calls++;
        return params.toString();
      },
      ["search"],
    );

    await expect(search(new URLSearchParams("q=apples"))).resolves.toBe("q=apples");
    await expect(search(new URLSearchParams("q=oranges"))).resolves.toBe("q=oranges");
    await expect(search(new URLSearchParams("q=apples"))).resolves.toBe("q=apples");
    expect(calls).toBe(2);
  });

  it("caches unstable_cache calls separately per Headers contents", async () => {
    let calls = 0;
    const auth = unstable_cache(
      async (headers: Headers) => {
        calls++;
        return headers.get("x-auth");
      },
      ["auth"],
    );

    await expect(auth(new Headers({ "x-auth": "token-1" }))).resolves.toBe("token-1");
    await expect(auth(new Headers({ "x-auth": "token-2" }))).resolves.toBe("token-2");
    await expect(auth(new Headers({ "x-auth": "token-1" }))).resolves.toBe("token-1");
    expect(calls).toBe(2);
  });
});

describe("cross-adapter behavior with URLSearchParams and Headers", () => {
  function makeSharedStorage() {
    const store = new Map<string, unknown>();
    const storage: FarmCacheStorage = {
      getItem: async <T>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
      setItem: async (key: string, value: unknown) => {
        store.set(key, value);
      },
      removeItem: async (key: string) => {
        store.delete(key);
      },
    };
    return { storage, store };
  }

  it("does not alias distinct URLSearchParams calls across caches sharing storage", async () => {
    const { storage } = makeSharedStorage();
    // Two FarmDataCache instances over the SAME storage simulate two server
    // processes sharing a Redis-like adapter. With the fix, distinct params
    // produce distinct adapter keys, so B cannot serve A's payload.
    const cacheA = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });
    const cacheB = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });

    let calls = 0;
    const loader = async (query: string) => {
      calls++;
      return `result-for-${query}`;
    };

    const keyApples = createFarmCacheKey(["search", new URLSearchParams("q=apples")]);
    const keyOranges = createFarmCacheKey(["search", new URLSearchParams("q=oranges")]);
    expect(keyApples).not.toBe(keyOranges);

    const a = await cacheA.getOrSet(keyApples, () => loader("q=apples"));
    expect(a).toBe("result-for-q=apples");
    expect(calls).toBe(1);

    const b = await cacheB.getOrSet(keyOranges, () => loader("q=oranges"));
    expect(b).toBe("result-for-q=oranges");
    expect(calls).toBe(2);
  });

  it("does not alias distinct Headers calls across caches sharing storage", async () => {
    const { storage } = makeSharedStorage();
    const cacheA = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });
    const cacheB = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });

    let calls = 0;
    const loader = async (token: string) => {
      calls++;
      return `data-${token}`;
    };

    const keyOne = createFarmCacheKey(["auth", new Headers({ "x-auth": "token-1" })]);
    const keyTwo = createFarmCacheKey(["auth", new Headers({ "x-auth": "token-2" })]);
    expect(keyOne).not.toBe(keyTwo);

    const a = await cacheA.getOrSet(keyOne, () => loader("token-1"));
    const b = await cacheB.getOrSet(keyTwo, () => loader("token-2"));
    expect(a).toBe("data-token-1");
    expect(b).toBe("data-token-2");
    expect(calls).toBe(2);
  });

  it("still reuses an entry when the same URLSearchParams content is requested again", async () => {
    const { storage } = makeSharedStorage();
    const cacheA = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });
    const cacheB = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });

    let calls = 0;
    const loader = async (query: string) => {
      calls++;
      return `result-for-${query}`;
    };

    const key = createFarmCacheKey(["search", new URLSearchParams("q=apples")]);

    const a = await cacheA.getOrSet(key, () => loader("q=apples"));
    // Same content from a different cache instance must hit the shared entry.
    const b = await cacheB.getOrSet(key, () => loader("q=apples"));
    expect(a).toBe("result-for-q=apples");
    expect(b).toBe("result-for-q=apples");
    expect(calls).toBe(1);
  });
});
