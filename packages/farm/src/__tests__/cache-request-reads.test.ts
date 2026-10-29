import { afterEach, describe, expect, it } from "vitest";
import { getFarmDataCache, unstable_cache } from "../cache";
import { cookies, getCspNonce, headers } from "../headers";
import { createServerFn } from "../server-fn";
import { _runWithCurrentRequest, _runWithFarmCspNonce, getCurrentRequest } from "../server/request";

const asVisitor = (session: string, fn: () => Promise<unknown>) =>
  _runWithCurrentRequest(
    new Request("https://app.test/account", { headers: { cookie: `session=${session}` } }),
    fn,
  );

describe("unstable_cache request reads", () => {
  afterEach(() => getFarmDataCache().clear());

  // The entry is shared by every visitor, so a cookie read inside it would
  // cache one visitor's data and serve it to the next.
  it("refuses cookies() inside the cached function", async () => {
    const load = unstable_cache(async () => cookies().get("session")?.value ?? null);

    await expect(asVisitor("alice", () => load())).rejects.toThrow(
      /cookies\(\) cannot be called inside unstable_cache\(\)/,
    );
    await expect(asVisitor("bob", () => load())).rejects.toThrow(/cookies\(\)/);
  });

  it("refuses headers(), getCurrentRequest(), and getCspNonce()", async () => {
    for (const read of [
      () => headers().get("cookie"),
      () => getCurrentRequest().url,
      () => getCspNonce(),
    ]) {
      getFarmDataCache().clear();
      const load = unstable_cache(async () => read(), [String(read)]);
      await expect(
        asVisitor("alice", () => _runWithFarmCspNonce("n0nce", () => load())),
      ).rejects.toThrow(/cannot be called inside unstable_cache\(\)/);
    }
  });

  it("refuses the request a server function gets inside the cached function", async () => {
    const whoAmI = createServerFn({
      handler: async ({ request }) => request?.headers.get("cookie") ?? null,
    });
    const load = unstable_cache(async () => whoAmI());

    await expect(asVisitor("alice", () => load())).rejects.toThrow(/request\.headers/);
  });

  it("still reads the request outside the cached function", async () => {
    const load = unstable_cache(async (session: string | null) => `profile:${session}`);
    const read = () => load(cookies().get("session")?.value ?? null);

    await expect(asVisitor("alice", read)).resolves.toBe("profile:alice");
    await expect(asVisitor("bob", read)).resolves.toBe("profile:bob");
  });
});
