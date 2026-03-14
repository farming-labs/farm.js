import { describe, expectTypeOf, it, vi } from "vitest";
import { createAPIClient, type CacheKey } from "../api/client";

type APIRouter = {
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
  it("infers optimistic updater types from route refs and typed cache keys", async () => {
    globalThis.fetch = vi.fn(async () => buildResponse({ success: true })) as any;

    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });
    type UsersKey = Awaited<ReturnType<typeof api.users.get>>["key"];
    const usersKey = "demo:users:list" as UsersKey;

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
              (prev) => {
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
            ],
            [
              usersKey,
              (prev) => {
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
            ],
          ],
        },
      },
    );
  });
});
