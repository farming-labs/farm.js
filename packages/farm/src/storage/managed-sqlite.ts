import type { Client, InValue, Transaction } from "@libsql/core/api";
import type { SchemaDefinition } from "@farming-labs/orm";
import type { SqlAdapterLike } from "@farming-labs/orm-sql";
import type { Driver } from "unstorage";

export interface ManagedSqliteOptions {
  managed: true | { name: string };
  schema?: SchemaDefinition;
  path?: never;
  url?: never;
}

/**
 * What a hosted mount holds. A `"kv"` mount is read with `getStorage()`, a `"sql"` mount with
 * `getDatabase()`. One mount is never both.
 */
export type ManagedStorageType = "kv" | "sql";

export interface ManagedSqliteMount {
  driver: "farm-managed-sqlite";
  /** Driver selected in the app config, when reported by the declaring framework. */
  declaredDriver?: string;
  managed: ManagedSqliteOptions["managed"];
  schema?: SchemaDefinition;
  /** Absent only on a mount from a deprecated untyped `farmStorage()` call. */
  type?: ManagedStorageType;
}

export function managedSqliteName(mount: string, managed: unknown) {
  const name =
    managed === true
      ? mount
      : managed && typeof managed === "object" && "name" in managed
        ? managed.name
        : undefined;
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(name))
    throw new TypeError(
      "Use a managed SQLite name of 1–63 lowercase letters, digits, or hyphens starting with a letter.",
    );
  return name;
}

function secureUrl(value: string) {
  const url = new URL(value);
  const local =
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (
    !(url.protocol === "https:" || (local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Use HTTPS or a loopback URL for Farm managed SQLite.");
  return url;
}

export async function requestSqliteResource(
  name: string,
  operation: "provision" | "token",
  declarations?: { mount: string; driver: string }[],
) {
  const key = process.env.FARMJS_API_KEY;
  if (!key) throw new Error("Set FARMJS_API_KEY on the server to access managed SQLite.");
  const base = secureUrl(process.env.FARMJS_API_URL || "https://app.farmjs.dev");
  const headers = new Headers({
    authorization: "Bearer " + key,
    "content-type": "application/json",
  });
  if (process.env.FARMJS_PROJECT_ID) headers.set("x-farm-project", process.env.FARMJS_PROJECT_ID);
  const environment = process.env.FARMJS_ENVIRONMENT;
  if (environment)
    headers.set("x-farm-environment", environment === "preview" ? "staging" : environment);
  const response = await fetch(new URL("/api/storage/sqlite/" + operation, base), {
    method: operation === "token" ? "POST" : "PUT",
    headers,
    body: JSON.stringify(operation === "provision" ? { name, declarations } : { name }),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result?.message === "string"
        ? result.message
        : "Farm SQLite request failed (HTTP " + response.status + ").",
    );
  return result;
}

async function credential(name: string) {
  const result = await requestSqliteResource(name, "token");
  if (
    !result ||
    typeof result.url !== "string" ||
    typeof result.token !== "string" ||
    !result.token ||
    !Number.isFinite(Date.parse(result.expiresAt)) ||
    Date.parse(result.expiresAt) <= Date.now()
  )
    throw new Error("Farm returned an invalid SQLite credential. Check the Infra service.");
  return {
    url: secureUrl(result.url).href,
    token: result.token as string,
    expires: Date.parse(result.expiresAt),
  };
}

type LoadClient = () => Promise<typeof import("./libsql-http")>;

async function connect(name: string, loadClient: LoadClient) {
  const [{ createClient }, initial] = await Promise.all([loadClient(), credential(name)]);
  let current = initial;
  let refreshing: Promise<typeof current> | undefined;
  return createClient({
    url: current.url,
    fetch: async (request: Request) => {
      if (new URL(request.url).origin !== new URL(initial.url).origin)
        throw new Error("The database endpoint changed. Reconnect the managed SQLite mount.");
      if (current.expires - Date.now() < 30000) {
        refreshing ??= credential(name).finally(() => {
          refreshing = undefined;
        });
        const renewed = await refreshing;
        if (renewed.url !== initial.url)
          throw new Error("The SQLite resource changed. Reconnect the mount.");
        current = renewed;
      }
      const headers = new Headers(request.headers);
      headers.set("authorization", "Bearer " + current.token);
      return fetch(request, { headers, redirect: "error" });
    },
  });
}

export const databaseAccessor = Symbol.for("farmjs.storage.managedDatabase");

export const mountSchema = Symbol.for("farmjs.storage.managedSchema");

export const mountType = Symbol.for("farmjs.storage.managedType");

export function managedSqliteDriver(
  name: string,
  loadClient: LoadClient,
  schema?: SchemaDefinition,
  type?: ManagedStorageType,
  mount = name,
): Driver & {
  [databaseAccessor]: () => Promise<Client>;
  [mountSchema]?: SchemaDefinition;
  [mountType]?: ManagedStorageType;
} {
  let pending: Promise<Client> | undefined;
  let initialized: Promise<Client> | undefined;
  let closed = false;
  function client() {
    if (closed) throw new Error("The managed SQLite mount has been disposed.");
    return (pending ??= connect(name, loadClient).catch((error) => {
      pending = undefined;
      throw error;
    }));
  }
  function kv() {
    if (type === "sql")
      return Promise.reject(
        new TypeError(
          `Storage mount ${JSON.stringify(mount)} is a SQL mount. ` +
            `Use getDatabase(${JSON.stringify(mount)}) to read and write it, ` +
            'or add a mount with `type: "kv"` for key-value data.',
        ),
      );
    return (initialized ??= client()
      .then(async (db) => {
        await db.execute(
          "CREATE TABLE IF NOT EXISTS _farm_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        );
        return db;
      })
      .catch((error) => {
        initialized = undefined;
        throw error;
      }));
  }
  return {
    name: "farm-managed-sqlite",
    [databaseAccessor]: client,
    [mountSchema]: schema,
    [mountType]: type,
    async hasItem(key) {
      return (
        (await (await kv()).execute({ sql: "SELECT 1 FROM _farm_kv WHERE key=?", args: [key] }))
          .rows.length > 0
      );
    },
    async getItem(key) {
      const { rows } = await (
        await kv()
      ).execute({ sql: "SELECT value FROM _farm_kv WHERE key=?", args: [key] });
      return rows[0]?.value ?? null;
    },
    async getKeys(base = "") {
      // A SQL mount holds no keys, so a listing that spans every mount still succeeds.
      if (type === "sql") return [];
      const { rows } = await (
        await kv()
      ).execute({
        sql: "SELECT key FROM _farm_kv WHERE instr(key,?)=1 ORDER BY key",
        args: [base],
      });
      return rows.map((row) => String(row.key));
    },
    async setItem(key, value) {
      await (
        await kv()
      ).execute({
        sql: "INSERT INTO _farm_kv(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        args: [key, value],
      });
    },
    async removeItem(key) {
      await (await kv()).execute({ sql: "DELETE FROM _farm_kv WHERE key=?", args: [key] });
    },
    async clear(base = "") {
      if (type === "sql") return;
      await (
        await kv()
      ).execute({ sql: "DELETE FROM _farm_kv WHERE instr(key,?)=1", args: [base] });
    },
    async dispose() {
      closed = true;
      (await pending)?.close();
    },
  };
}

function sqlAdapter(client: Client, tx?: Transaction): SqlAdapterLike {
  return {
    dialect: "sqlite",
    async query(sql, params) {
      const result = await (tx ?? client).execute({ sql, args: params as InValue[] });
      return {
        rows: result.rows,
        affectedRows: result.rowsAffected,
        insertId: result.lastInsertRowid,
      };
    },
    async transaction(run) {
      if (tx) throw new Error("Nested managed SQLite transactions are unsupported.");
      const transaction = await client.transaction("write");
      try {
        const value = await run(sqlAdapter(client, transaction));
        await transaction.commit();
        return value;
      } catch (error) {
        if (!transaction.closed) await transaction.rollback();
        throw error;
      } finally {
        transaction.close();
      }
    },
  };
}

export async function managedOrm<S extends SchemaDefinition<any>>(client: Client, schema: S) {
  const [{ createOrm }, { createSqlDriverFromAdapter }] = await Promise.all([
    import("@farming-labs/orm"),
    import("@farming-labs/orm-sql"),
  ]);
  return createOrm({ schema, driver: createSqlDriverFromAdapter<S>(sqlAdapter(client)) });
}
