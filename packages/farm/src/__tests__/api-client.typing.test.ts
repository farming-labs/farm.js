import { describe, expectTypeOf, it, vi } from "vitest";
import { createAPIClient, type CacheKey } from "../api/client";

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
});
