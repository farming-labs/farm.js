// @vitest-environment node

import { defineSchema, id, model } from "@farming-labs/orm";
import { createClient } from "@libsql/client/http";
import { afterEach, expect, it, vi } from "vitest";
import {
  _collectFarmStorageModules,
  createStorageClient,
  disposeStorage,
  farmStorage,
  getDatabase,
  initStorage,
  memoryStorage,
  localStorage,
  postgresStorage,
  pgStorage,
  redisStorage,
  resolveManagedStorageMount,
  mysqlStorage,
  mysql2Storage,
  pgliteStorage,
  planetscaleStorage,
  libsqlStorage,
  s3Storage,
  mongodbStorage,
  upstashStorage,
  netlifyBlobsStorage,
  vercelKVStorage,
  vercelBlobStorage,
  sqliteStorage,
} from "../storage";
import { databaseAccessor, managedSqliteDriver } from "../storage/managed-sqlite";

afterEach(async () => {
  await disposeStorage();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("resolves Farm storage to the same hosted resources as existing managed mounts", () => {
  expect(farmStorage()).toEqual(sqliteStorage({ managed: true }));
  expect(farmStorage({ namespace: "drafts" })).toEqual(
    sqliteStorage({ managed: { name: "drafts" } }),
  );
  expect(() => farmStorage({ namespace: "bad/name" })).toThrow();
  // @ts-expect-error Hosted storage cannot point to a local file.
  expect(() => farmStorage({ path: "./drafts.sqlite" })).toThrow();
});

it("accepts an explicit managed flag with either an inferred or an explicit namespace", () => {
  expect(farmStorage({ managed: true })).toEqual(farmStorage());
  expect(farmStorage({ managed: true, namespace: "drafts" })).toEqual(
    farmStorage({ namespace: "drafts" }),
  );
  // @ts-expect-error Farm-hosted storage only accepts true.
  expect(() => farmStorage({ managed: false })).toThrow(/managed/);
});

it.each(
  Object.entries({
    sqliteStorage,
    postgresStorage,
    pgStorage,
    mysqlStorage,
    mysql2Storage,
    pgliteStorage,
    planetscaleStorage,
    libsqlStorage,
    redisStorage,
    s3Storage,
    mongodbStorage,
    upstashStorage,
    netlifyBlobsStorage,
    vercelKVStorage,
    vercelBlobStorage,
    localStorage,
    memoryStorage,
  }),
)("%s uses Farm hosting when managed storage is requested", (_name, helper) => {
  expect(helper({ managed: true })).toEqual(farmStorage());
  expect(helper({ managed: true, namespace: "drafts" })).toEqual(
    farmStorage({ namespace: "drafts" }),
  );
});

it("plans and loads only the hosted client for managed native and raw KV declarations", async () => {
  vi.stubEnv("FARMJS_API_KEY", "");
  const config = {
    mounts: {
      cache: redisStorage({ managed: true }),
      drafts: { driver: "postgres", managed: true },
      settings: createStorageClient({ driver: "cloudflare-kv-binding", managed: true }),
    },
  } as const;
  expect(_collectFarmStorageModules(config)).toEqual(["@libsql/client/http"]);
  await initStorage(config);
  for (const name of Object.keys(config.mounts))
    await expect(getDatabase(name)).rejects.toThrow("FARMJS_API_KEY");
});

it("keeps native drivers when management is off and rejects mixed hosted connection options", () => {
  const client = redisStorage({ managed: false, url: "redis://localhost" });
  expect(_collectFarmStorageModules({ mounts: { cache: client } })).toEqual([
    "unstorage/drivers/redis",
  ]);
  // @ts-expect-error A managed mount cannot also use a provider URL.
  expect(() => postgresStorage({ managed: true, url: "postgres://localhost" })).toThrow(/managed/);
  // @ts-expect-error A managed mount cannot silently drop a provider option.
  expect(() => redisStorage({ managed: true, ttl: 30 })).toThrow(/managed/);
});

it("rejects an unknown or injected driver and validates raw managed options before provisioning", () => {
  for (const driver of ["unknown-provider", "db0", () => ({})]) {
    expect(() => resolveManagedStorageMount({ driver, managed: true })).toThrow(/built-in/);
  }
  expect(() =>
    resolveManagedStorageMount({ driver: "redis", managed: true, options: { ttl: 10 } }),
  ).toThrow(/driver options/);
  expect(() =>
    resolveManagedStorageMount({ driver: "postgres", managed: true, namespace: "bad/name" }),
  ).toThrow(/name/);
});

it("plans a named mount without a credential or a remote request", async () => {
  vi.stubEnv("FARMJS_API_KEY", "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await initStorage({
    mounts: { drafts: farmStorage(), cache: memoryStorage() },
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

it("binds the ORM schema to the mount and leaves raw access available", async () => {
  const schema = defineSchema({ draft: model({ table: "drafts", fields: { id: id() } }) });
  const bare = farmStorage({ namespace: "drafts" });
  const bound = postgresStorage({ managed: true, namespace: "drafts", schema });
  expect(farmStorage({ namespace: "drafts", schema })).toEqual(bound);
  expect(bound.schema).toBe(schema);
  expect(() => resolveManagedStorageMount({ driver: "redis", schema })).toThrow(/managed: true/);
  expect(() => resolveManagedStorageMount({ driver: "redis", managed: true, schema: {} })).toThrow(
    /defineSchema/,
  );
  vi.stubEnv("FARMJS_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        url: "https://drafts.example.test",
        token: "fixture",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      }),
    ),
  );
  await initStorage({ mounts: { drafts: bound, archive: bare } });
  expect(await getDatabase("drafts")).toHaveProperty("draft.findMany");
  expect(await getDatabase("drafts", { raw: true })).toHaveProperty("execute");
  expect(await getDatabase("archive")).toHaveProperty("execute");
  expect(await getDatabase("archive", { schema })).toHaveProperty("draft.create");
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
