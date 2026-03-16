import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { middleware } from "../middleware/chain";
import { createContext } from "../middleware/context";
import {
  createFarmStorage,
  createStorageClient,
  disposeStorage,
  getStorage,
  initStorage,
  localStorage,
  mongodbStorage,
  mysqlStorage,
  postgresStorage,
  redisStorage,
  s3Storage,
  sqliteStorage,
  upstashStorage,
  vercelKVStorage,
} from "../storage";
import type { MiddlewareContext } from "../middleware/types";

const tempDirs = new Set<string>();

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

async function executeChain(handlers: any[], ctx: MiddlewareContext) {
  let index = 0;

  const executeNext = async (): Promise<void> => {
    if (index < handlers.length && !ctx._handled) {
      const handler = handlers[index++];
      await handler(ctx, executeNext);
    }
  };

  await executeNext();
}

function createMockRequest(url: string, method = "GET"): IncomingMessage {
  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", {
    configurable: true,
    value: "127.0.0.1",
  });

  const req = new IncomingMessage(socket);
  req.url = url;
  req.method = method;
  req.headers = {
    host: "localhost:3000",
  };
  return req;
}

function createMockResponse(): ServerResponse {
  const res = new ServerResponse(createMockRequest("/"));
  res.writeHead = vi.fn().mockReturnValue(res);
  res.end = vi
    .fn()
    .mockImplementation((chunk?: any, encoding?: BufferEncoding, cb?: (() => void) | undefined) => {
      if (typeof cb === "function") {
        cb();
      }
      return res;
    });
  res.setHeader = vi.fn();
  return res;
}

describe("Storage", () => {
  beforeEach(async () => {
    await disposeStorage();
  });

  afterEach(async () => {
    await disposeStorage();

    await Promise.all(
      [...tempDirs].map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
        tempDirs.delete(dir);
      }),
    );
  });

  it("creates an in-memory storage by default", async () => {
    const storage = await createFarmStorage();

    await storage.setItem("greeting", { hello: "world" });

    expect(await storage.getItem("greeting")).toEqual({ hello: "world" });

    await storage.dispose();
  });

  it("supports mounted local namespaces with shorthand options", async () => {
    const dir = await createTempDir("farm-storage-local-");
    const cacheClient = localStorage({ base: dir });

    await initStorage({
      mounts: {
        cache: cacheClient,
      },
    });

    const cache = getStorage("cache");
    await cache.setItem("users", { total: 1 });

    expect(await cache.getItem("users")).toEqual({ total: 1 });
    expect(await readdir(dir)).not.toHaveLength(0);
  });

  it("stores the active storage instance on globalThis", async () => {
    const key = Symbol.for("farmjs.storage.global");
    const storage = await initStorage({});
    expect((globalThis as Record<PropertyKey, unknown>)[key]).toBe(storage);
  });

  it("clears mounted namespaces without wiping unrelated storage", async () => {
    const dir = await createTempDir("farm-storage-mounted-clear-");

    await initStorage({
      mounts: {
        cache: localStorage({ base: dir }),
      },
    });

    await getStorage().setItem("root", { ok: true });
    const cache = getStorage("cache");
    await cache.setItem("users", { total: 1 });
    await cache.setItem("posts", { total: 2 });

    await cache.clear();

    expect(await cache.getKeys()).toEqual([]);
    expect(await getStorage().getItem("root")).toEqual({ ok: true });
  });

  it("supports sqlite storage with a simple path-based config", async () => {
    const dir = await createTempDir("farm-storage-sqlite-");
    const dbPath = path.join(dir, "app.sqlite");
    const sqliteClient = sqliteStorage({
      path: dbPath,
      tableName: "farm_storage_test",
    });

    const storage = await createFarmStorage(sqliteClient);

    await storage.setItem("user", { name: "Ada", role: "admin" });

    expect(await storage.getItem("user")).toEqual({
      name: "Ada",
      role: "admin",
    });

    await storage.dispose();
    expect(await readdir(dir)).not.toHaveLength(0);
  });

  it("lets helper-created clients act like ready storage instances", async () => {
    const dir = await createTempDir("farm-storage-ready-");
    const sqlite = sqliteStorage({
      path: path.join(dir, "ready.sqlite"),
      tableName: "ready_store",
    });

    await sqlite.setItem("project", { name: "farm" });

    expect(await sqlite.getItem("project")).toEqual({ name: "farm" });

    await sqlite.dispose();
  });

  it("persists sqlite data across recreated instances and supports delete/clear", async () => {
    const dir = await createTempDir("farm-storage-persist-");
    const dbPath = path.join(dir, "persist.sqlite");

    const first = sqliteStorage({
      path: dbPath,
      tableName: "persist_store",
    });

    await first.setItems([
      { key: "item:1", value: { label: "one" } },
      { key: "item:2", value: { label: "two" } },
    ]);
    await first.dispose();

    const second = sqliteStorage({
      path: dbPath,
      tableName: "persist_store",
    });

    expect(await second.getItem("item:1")).toEqual({ label: "one" });
    expect(await second.getItem("item:2")).toEqual({ label: "two" });

    await second.removeItem("item:1");
    expect(await second.getItem("item:1")).toBeNull();

    await second.clear();
    expect(await second.getKeys()).toEqual([]);

    await second.dispose();
  });

  it("uses the configured ratelimit namespace for default rate limiting", async () => {
    const dir = await createTempDir("farm-storage-ratelimit-");

    await initStorage({
      mounts: {
        ratelimit: {
          driver: "local",
          base: dir,
        },
      },
    });

    const chain = middleware().rateLimit({
      window: "1m",
      requests: 1,
    });
    const { handlers } = chain.build();

    const firstReq = createMockRequest("/limited");
    const firstRes = createMockResponse();
    await executeChain(handlers, createContext(firstReq, firstRes));

    const secondReq = createMockRequest("/limited");
    const secondRes = createMockResponse();
    await executeChain(handlers, createContext(secondReq, secondRes));

    expect(secondRes.writeHead).toHaveBeenCalledWith(429, expect.any(Object));
    expect(await getStorage("ratelimit").getKeys()).not.toHaveLength(0);
    expect(await readdir(dir)).not.toHaveLength(0);
  });

  it("supports reusable created clients in config mounts and root client config", async () => {
    const rootDir = await createTempDir("farm-storage-root-");
    const sessionDir = await createTempDir("farm-storage-session-");

    const rootClient = sqliteStorage({
      path: path.join(rootDir, "root.sqlite"),
      tableName: "root_store",
    });
    const sessionClient = createStorageClient({
      driver: "local",
      base: sessionDir,
    });

    await initStorage({
      client: rootClient,
      mounts: {
        sessions: sessionClient,
      },
    });

    await getStorage().setItem("app", { healthy: true });
    await getStorage("sessions").setItem("user:1", { id: 1 });

    expect(await getStorage().getItem("app")).toEqual({ healthy: true });
    expect(await getStorage("sessions").getItem("user:1")).toEqual({ id: 1 });
    expect(await readdir(rootDir)).not.toHaveLength(0);
    expect(await readdir(sessionDir)).not.toHaveLength(0);
  });

  it("creates ready helper clients for common remote backends", async () => {
    const redis = redisStorage({ url: "redis://localhost:6379" });
    const postgres = postgresStorage({
      url: "postgres://localhost:5432/app",
      tableName: "app_store",
    });
    const mysql = mysqlStorage({
      host: "localhost",
      user: "root",
      password: "secret",
      database: "app",
      tableName: "app_store",
    });
    const mongo = mongodbStorage({
      connectionString: "mongodb://localhost:27017",
      databaseName: "app",
      collectionName: "storage",
    });
    const s3 = s3Storage({
      bucket: "demo-bucket",
      region: "us-east-1",
      accessKeyId: "key",
      secretAccessKey: "secret",
    });
    const upstash = upstashStorage({
      url: "https://example.upstash.io",
      token: "token",
    });
    const vercelKV = vercelKVStorage({});

    expect(redis.kind).toBe("farm-storage-client");
    expect(postgres.kind).toBe("farm-storage-client");
    expect(mysql.kind).toBe("farm-storage-client");
    expect(mongo.kind).toBe("farm-storage-client");
    expect(s3.kind).toBe("farm-storage-client");
    expect(upstash.kind).toBe("farm-storage-client");
    expect(vercelKV.kind).toBe("farm-storage-client");

    expect(typeof redis.setItem).toBe("function");
    expect(typeof postgres.getItem).toBe("function");
    expect(typeof mysql.setItems).toBe("function");
    expect(typeof mongo.getKeys).toBe("function");
    expect(typeof s3.removeItem).toBe("function");
    expect(typeof upstash.clear).toBe("function");
    expect(typeof vercelKV.hasItem).toBe("function");
  });

  const itWithPostgres = process.env.FARM_TEST_POSTGRES_URL ? it : it.skip;

  itWithPostgres("supports postgres storage against a real database", async () => {
    const tableName = `farm_pg_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const pg = postgresStorage({
      url: process.env.FARM_TEST_POSTGRES_URL!,
      tableName,
    });

    await pg.setItem("user:1", { id: 1, name: "Ada" });
    await pg.setItems([
      { key: "user:2", value: { id: 2, name: "Grace" } },
      { key: "user:3", value: { id: 3, name: "Linus" } },
    ]);

    expect(await pg.getItem("user:1")).toEqual({ id: 1, name: "Ada" });
    expect(await pg.getItem("user:2")).toEqual({ id: 2, name: "Grace" });

    await pg.removeItem("user:2");
    expect(await pg.getItem("user:2")).toBeNull();

    await pg.clear();
    expect(await pg.getKeys()).toEqual([]);

    await pg.dispose();
  }, 30_000);
});
