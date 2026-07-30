import { describe, expectTypeOf, it, vi } from "vitest";
import { createAPIClient, createServerAPIClient, type CacheKey } from "../api/client";
import { defineCacheKey } from "../cache";
import { endpoint } from "../integration-api";

type APIRouter = {
  hello: {
    get: {
      __types: {
        body: never;
        query: { name?: string };
        response: { message: string; timestamp: string };
      };
    };
    post: {
      __types: {
        body: { name?: string };
        query: never;
        response: { message: string; timestamp: string };
      };
    };
  };
  search: {
    get: {
      __types: {
        body: never;
        query: { term: string; page?: string };
        response: { results: string[] };
      };
    };
  };
  users: {
    get: {
      __types: {
        body: never;
        query: { limit?: string };
        response: {
          users: Array<{ id: string; name: string; email?: string }>;
          total: number;
          limit: number;
          offset: number;
        };
      };
    };
    post: {
      __types: {
        body: { name: string; email: string };
        query: never;
        response: { success: boolean };
      };
    };
  };
};

type UsersListResponse = APIRouter["users"]["get"]["__types"]["response"];
type AppIntegrations = {
  localDemo: {
    message: {
      get: ReturnType<typeof endpoint.get<{ ok: boolean; source: string }>>;
      post: ReturnType<typeof endpoint.post<{ message: string }, { ok: boolean; source: string }>>;
    };
  };
};
type IsAny<T> = 0 extends 1 & T ? true : false;

const buildResponse = (data: any, ok = true, status = 200) => ({
  ok,
  status,
  statusText: ok ? "OK" : "Bad Request",
  json: async () => data,
});

describe("createAPIClient typing", () => {
  it("maps generated route types into callable api.route.method helpers", async () => {
    globalThis.fetch = vi.fn(async () =>
      buildResponse({ message: "Hello Peeps, World!", timestamp: "2026-07-03T00:00:00.000Z" }),
    ) as any;

    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });

    const helloWithoutQuery = await api.hello.get();
    const helloWithQuery = await api.hello.get({ query: { name: "Farm" } });
    const helloPost = await api.hello.post({ body: { name: "Farm" } });
    const search = await api.search.get({ query: { term: "routes" } });

    expectTypeOf<IsAny<typeof helloWithoutQuery.data>>().toEqualTypeOf<false>();
    expectTypeOf(helloWithoutQuery.data).toEqualTypeOf<
      { message: string; timestamp: string } | undefined
    >();
    expectTypeOf(helloWithQuery.data?.message).toEqualTypeOf<string | undefined>();
    expectTypeOf(helloPost.data?.timestamp).toEqualTypeOf<string | undefined>();
    expectTypeOf(search.data?.results).toEqualTypeOf<string[] | undefined>();

    // @ts-expect-error body schemas require the body wrapper.
    await api.hello.post();
    // @ts-expect-error unknown query keys are rejected from generated route types.
    await api.hello.get({ query: { nope: "Farm" } });
    // @ts-expect-error required query fields stay required.
    await api.search.get();
    // @ts-expect-error required body fields stay required.
    await api.users.post({ body: { name: "Ada" } });
  });

  it("infers optimistic updater types from route refs and typed cache keys", async () => {
    globalThis.fetch = vi.fn(async () => buildResponse({ success: true })) as any;

    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });
    type UsersKey = Awaited<ReturnType<typeof api.users.get>>["key"];
    type UsersRouteHasMeta = typeof api.users.get extends {
      readonly __farmRouteInput: unknown;
      readonly __farmRouteData: unknown;
    }
      ? true
      : false;
    type UsersRouteData = (typeof api.users.get)["__farmRouteData"];
    const usersKey = "demo:users:list" as UsersKey;

    expectTypeOf<UsersRouteHasMeta>().toEqualTypeOf<true>();
    expectTypeOf<UsersRouteData>().toEqualTypeOf<UsersListResponse>();
    expectTypeOf<UsersKey>().toEqualTypeOf<CacheKey<UsersListResponse>>();

    await api.users.post(
      { body: { name: "Ada", email: "ada@example.com" } },
      {
        key: "demo:users:create",
        optimistic: {
          update: [
            [
              api.users.get,
              { query: { limit: "5" } },
              (prev: UsersListResponse | undefined) => {
                expectTypeOf<IsAny<typeof prev>>().toEqualTypeOf<false>();
                expectTypeOf(prev).toEqualTypeOf<UsersListResponse | undefined>();

                return {
                  users: [
                    { id: "temp-route", name: "Ada", email: "ada@example.com" },
                    ...(prev?.users ?? []),
                  ],
                  total: (prev?.total ?? 0) + 1,
                  limit: prev?.limit ?? 5,
                  offset: prev?.offset ?? 0,
                };
              },
            ] as const,
            [
              usersKey,
              (prev: UsersListResponse | undefined) => {
                expectTypeOf<IsAny<typeof prev>>().toEqualTypeOf<false>();
                expectTypeOf(prev).toEqualTypeOf<UsersListResponse | undefined>();

                return {
                  users: [
                    { id: "temp-key", name: "Ada", email: "ada@example.com" },
                    ...(prev?.users ?? []),
                  ],
                  total: (prev?.total ?? 0) + 1,
                  limit: prev?.limit ?? 5,
                  offset: prev?.offset ?? 0,
                };
              },
            ] as const,
          ] as const,
        },
      },
    );
  });

  it("accepts optional defined cache keys without changing raw key support", async () => {
    globalThis.fetch = vi.fn(async () =>
      buildResponse({
        users: [],
        total: 0,
        limit: 5,
        offset: 0,
      }),
    ) as any;

    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });
    const usersKey = defineCacheKey<UsersListResponse>()(
      (limit: string) => ["users", "list", { limit }] as const,
    );
    const key = usersKey("5");

    await api.users.get(
      { query: { limit: "5" } },
      {
        cache: {
          key,
          policy: "cache-first",
        },
      },
    );

    await api.users.post(
      { body: { name: "Ada", email: "ada@example.com" } },
      {
        invalidate: [key],
        optimistic: {
          update: [
            [
              key,
              (prev) => {
                expectTypeOf(prev).toEqualTypeOf<UsersListResponse | undefined>();
                return {
                  users: [{ id: "optimistic", name: "Ada" }, ...(prev?.users ?? [])],
                  total: (prev?.total ?? 0) + 1,
                  limit: prev?.limit ?? 5,
                  offset: prev?.offset ?? 0,
                };
              },
            ] as const,
          ] as const,
        },
      },
    );

    if (false) {
      await api.users.post(
        { body: { name: "Ada", email: "ada@example.com" } },
        {
          optimistic: {
            update: [
              // @ts-expect-error defined key updaters must return the key's data contract.
              [key, () => ({ success: true })] as const,
            ],
          },
        },
      );
    }

    await api.users.get(
      { query: { limit: "5" } },
      {
        // Existing untyped structured keys remain supported.
        cache: {
          key: ["users", "list", { limit: "5" }],
        },
      },
    );
  });

  it("adds typed integration namespaces to route API clients", async () => {
    const api = createAPIClient<APIRouter, AppIntegrations>({ baseURL: "http://example.com" });

    if (false) {
      const routeResult = await api.hello.get({ query: { name: "Farm" } });
      const integrationGet = await api.integrations.localDemo.message.get();
      const integrationPost = await api.integrations.localDemo.message.post({
        body: {
          message: "hello",
        },
      });

      expectTypeOf(routeResult.data?.message).toEqualTypeOf<string | undefined>();
      expectTypeOf(integrationGet.data).toEqualTypeOf<{ ok: boolean; source: string } | null>();
      expectTypeOf(integrationPost.data?.source).toEqualTypeOf<string | undefined>();

      // @ts-expect-error integration body schemas require the body wrapper.
      await api.integrations.localDemo.message.post();
      // @ts-expect-error unknown integration namespaces are rejected.
      api.integrations.missing;
    }
  });

  it("adds typed integration namespaces to server API clients", async () => {
    const api = createServerAPIClient<{}, AppIntegrations>({});

    if (false) {
      expectTypeOf(api.integrations.localDemo.message.get).toBeCallableWith();
      expectTypeOf(api.integrations.localDemo.message.post).toBeCallableWith({
        body: {
          message: "hello",
        },
      });

      // @ts-expect-error server integration calls still preserve operation input types.
      await api.integrations.localDemo.message.post({ body: { nope: "hello" } });
    }
  });

  it("allows opting out of the reserved integrations namespace", () => {
    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com", integrations: false });
    const serverApi = createServerAPIClient<{}>({}, { integrations: false });

    if (false) {
      // @ts-expect-error integrations is not present when the namespace is disabled.
      api.integrations;
      // @ts-expect-error integrations is not present when the server namespace is disabled.
      serverApi.integrations;
    }
  });
});
