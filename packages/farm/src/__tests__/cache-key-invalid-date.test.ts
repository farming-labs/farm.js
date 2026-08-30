import { afterEach, describe, expect, it } from "vitest";
import { configureFarmCache, createFarmCacheKey, unstable_cache } from "../cache";
import { createServerQueryCallKey } from "../server-query-runtime";

afterEach(() => {
  configureFarmCache(undefined);
});

describe("createFarmCacheKey with invalid Date", () => {
  it("serializes an invalid date to a stable marker instead of throwing", () => {
    expect(createFarmCacheKey([new Date("not-a-date")])).toBe("[date:invalid]");
    expect(createFarmCacheKey([new Date(NaN)])).toBe("[date:invalid]");
    expect(createFarmCacheKey([new Date("2024-13-45")])).toBe(
      createFarmCacheKey([new Date("also-invalid")]),
    );
  });

  it("keeps valid date serialization unchanged", () => {
    expect(createFarmCacheKey([new Date("2024-02-01T00:00:00.000Z")])).toBe(
      "[date:2024-02-01T00:00:00.000Z]",
    );
  });

  it("serializes an invalid date nested in objects, arrays, sets and maps", () => {
    const invalid = new Date(NaN);
    expect(createFarmCacheKey([{ from: invalid, list: [invalid] }])).toBe(
      '[{"from":date:invalid,"list":[date:invalid]}]',
    );
    expect(createFarmCacheKey([new Set([invalid])])).toBe("[set:[date:invalid]]");
    expect(createFarmCacheKey([new Map([["from", invalid]])])).toBe(
      '[map:[["from",date:invalid]]]',
    );
  });

  it("lets unstable_cache run the wrapped function for an invalid date argument", async () => {
    let calls = 0;
    const report = unstable_cache(
      async (from: Date) => {
        calls++;
        return Number.isNaN(from.getTime()) ? "invalid input" : `rows since ${from.toISOString()}`;
      },
      ["report"],
    );

    await expect(report(new Date("2024-13-45"))).resolves.toBe("invalid input");
    await expect(report(new Date("also-invalid"))).resolves.toBe("invalid input");
    expect(calls).toBe(1);

    await expect(report(new Date("2024-02-01T00:00:00.000Z"))).resolves.toBe(
      "rows since 2024-02-01T00:00:00.000Z",
    );
    expect(calls).toBe(2);
  });

  it("builds a server query call key for an invalid date input", () => {
    const query = (async () => null) as any;
    const key = createServerQueryCallKey(query, { from: new Date("2024-02-31x"), page: 1 });
    expect(key).toContain('"from":date:invalid');
    expect(key).toBe(createServerQueryCallKey(query, { from: new Date(NaN), page: 1 }));
    expect(key).not.toBe(
      createServerQueryCallKey(query, { from: new Date("2024-02-01T00:00:00.000Z"), page: 1 }),
    );
  });
});
