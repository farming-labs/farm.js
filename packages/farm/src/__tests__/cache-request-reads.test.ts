// @vitest-environment node
// The server `api` client and integration server clients refuse to run where `window` exists.
import { afterEach, describe, expect, it } from "vitest";
import { createApiClients } from "../api/client";
import { getFarmDataCache, unstable_cache } from "../cache";
import { cookies, getCspNonce, headers } from "../headers";
import { endpoint } from "../integration-api";
import { createIntegrationServerClient } from "../integration-client";
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

  // @farm.js/auth's auth.user()/auth.session() and integration clients read the
  // visitor's cookies through this global, so it must refuse here too.
  it("refuses the global current-request resolver", async () => {
    const resolve = () =>
      (globalThis as Record<symbol, (() => Request | undefined) | undefined>)[
        Symbol.for("farm.currentRequestResolver")
      ]?.();
    const profile = unstable_cache(
      async () => `profile:${resolve()?.headers.get("cookie") ?? "anon"}`,
      ["profile"],
    );

    await expect(asVisitor("alice", () => profile())).rejects.toThrow(
      /reads the current request .* cannot be called inside unstable_cache\(\)/,
    );
    await expect(asVisitor("bob", () => profile())).rejects.toThrow(/unstable_cache\(\)/);
    // Outside a cached function the resolver still hands over the request.
    await expect(asVisitor("bob", async () => resolve()?.headers.get("cookie"))).resolves.toBe(
      "session=bob",
    );
  });

  it("refuses the server api client", async () => {
    const { api } = createApiClients<any>({ integrations: false });
    const load = unstable_cache(async () => api.me.get(), ["me"]);

    await expect(asVisitor("alice", () => load())).rejects.toThrow(
      /reads the current request .* cannot be called inside unstable_cache\(\)/,
    );
  });

  it("refuses integration server clients", async () => {
    const server = createIntegrationServerClient({
      integrations: {
        account: {
          me: endpoint.route(
            "/api/account/me",
            endpoint.get<{ id: string }>({ responseFormat: "json", isServer: true }),
          ),
        },
      },
    });
    const load = unstable_cache(async () => server.account.me.get(), ["account"]);

    await expect(asVisitor("alice", () => load())).rejects.toThrow(
      /reads the current request .* cannot be called inside unstable_cache\(\)/,
    );
  });

  it("still runs a server function that never reads the request", async () => {
    const greet = createServerFn({ handler: async () => "hello" });
    const load = unstable_cache(async () => greet(), ["greet"]);

    await expect(asVisitor("alice", () => load())).resolves.toBe("hello");
  });

  it("still reads the request outside the cached function", async () => {
    const load = unstable_cache(async (session: string | null) => `profile:${session}`);
    const read = () => load(cookies().get("session")?.value ?? null);

    await expect(asVisitor("alice", read)).resolves.toBe("profile:alice");
    await expect(asVisitor("bob", read)).resolves.toBe("profile:bob");
  });
});
