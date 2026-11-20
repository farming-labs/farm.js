// @vitest-environment node

import { createClient } from "@libsql/client/http";
import { afterEach, expect, it, vi } from "vitest";
import { disposeStorage, getDatabase, initStorage, memoryStorage, sqliteStorage } from "../storage";
import { databaseAccessor, managedSqliteDriver } from "../storage/managed-sqlite";

afterEach(async () => {
  await disposeStorage();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("plans a named mount without a credential or a remote request", async () => {
  vi.stubEnv("FARMJS_API_KEY", "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await initStorage({
    mounts: { drafts: sqliteStorage({ managed: true }), cache: memoryStorage() },
  });
  await expect(getDatabase("drafts")).rejects.toThrow("FARMJS_API_KEY");
  await expect(getDatabase("cache")).rejects.toThrow("managed SQLite mount");
  await expect(getDatabase("drafts:other")).rejects.toThrow("managed SQLite mount");
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects conflicting connection settings and invalid resource names", () => {
  // @ts-expect-error A managed resource cannot also point to a local file.
  expect(() => sqliteStorage({ managed: true, path: "./drafts.sqlite" })).toThrow("managed");
  expect(() => sqliteStorage({ managed: { name: "bad/name" } })).toThrow("name");
});

it("refreshes once for concurrent requests and refuses a changed database endpoint on every attempt", async () => {
  vi.stubEnv("FARMJS_API_KEY", "test-key");
  vi.stubEnv("FARMJS_API_URL", "https://control.example.test");
  const url = "https://drafts.example.test";
  let issued = 0;
  const tokens: string[] = [];
  const network = vi.fn(async (input: Request | URL, options: RequestInit) => {
    if (input instanceof URL) {
      issued += 1;
      return Response.json({
        url: issued >= 3 ? "https://other.example.test" : url,
        token: "fixture-" + issued,
        expiresAt: new Date(Date.now() + (issued >= 3 ? 300000 : 20000)).toISOString(),
      });
    }
    tokens.push(new Headers(options.headers).get("authorization")!);
    return new Response();
  });
  vi.stubGlobal("fetch", network);
  let send!: (request: Request) => Promise<Response>;
  const driver = managedSqliteDriver(
    "drafts",
    async () =>
      ({
        createClient(config) {
          send = config.fetch as typeof send;
          return createClient(config);
        },
      }) as typeof import("@libsql/client/http"),
  );
  await driver[databaseAccessor]();
  const query = () => send(new Request(url + "/v2/pipeline"));
  await Promise.all([query(), query()]);
  expect(issued).toBe(2);
  expect(tokens).toEqual(["Bearer fixture-2", "Bearer fixture-2"]);
  await expect(query()).rejects.toThrow("resource changed");
  await expect(query()).rejects.toThrow("resource changed");
  await expect(send(new Request("https://other.example.test"))).rejects.toThrow("endpoint changed");
  expect(tokens).toHaveLength(2);
  await driver.dispose?.();
});
