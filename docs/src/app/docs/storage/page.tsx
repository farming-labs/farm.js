import { Link } from "@farmjs/core";

export const metadata = {
  title: "Storage - Farm.js",
  description: "Programmatic storage clients, mounted stores, and multi-driver usage in Farm.js.",
};

const helpers = [
  {
    name: "memoryStorage",
    note: "Fast ephemeral storage for tests and temporary state.",
    code: `import { memoryStorage } from "@farmjs/core/storage";

export const cache = memoryStorage();

await cache.setItem("session", { ok: true });`,
  },
  {
    name: "localStorage",
    note: "File-backed local persistence using unstorage fs-lite.",
    code: `import { localStorage } from "@farmjs/core/storage";

export const local = localStorage({
  base: "./.farm/storage/local",
});`,
  },
  {
    name: "sqliteStorage",
    note: "Local SQLite persistence for development and single-node deployments.",
    code: `import { sqliteStorage } from "@farmjs/core/storage";

export const sqlite = sqliteStorage({
  path: "./.farm/storage/app.sqlite",
  tableName: "app_store",
});`,
  },
  {
    name: "postgresStorage",
    note: "PostgreSQL-backed key-value storage using db0 + unstorage db0.",
    code: `import { postgresStorage } from "@farmjs/core/storage";

export const pg = postgresStorage({
  url: process.env.DATABASE_URL!,
  tableName: "session_store",
});`,
  },
  {
    name: "mysqlStorage",
    note: "MySQL or MariaDB-backed storage.",
    code: `import { mysqlStorage } from "@farmjs/core/storage";

export const mysql = mysqlStorage({
  host: process.env.MYSQL_HOST!,
  user: process.env.MYSQL_USER!,
  password: process.env.MYSQL_PASSWORD!,
  database: process.env.MYSQL_DATABASE!,
  tableName: "app_store",
});`,
  },
  {
    name: "redisStorage",
    note: "Redis-backed storage for cache, sessions, and rate limits.",
    code: `import { redisStorage } from "@farmjs/core/storage";

export const redis = redisStorage({
  url: process.env.REDIS_URL!,
});`,
  },
  {
    name: "mongodbStorage",
    note: "MongoDB-backed document storage via the unstorage driver.",
    code: `import { mongodbStorage } from "@farmjs/core/storage";

export const mongo = mongodbStorage({
  connectionString: process.env.MONGO_URL!,
  databaseName: "app",
  collectionName: "storage",
});`,
  },
  {
    name: "s3Storage",
    note: "S3-backed object storage for key-value blobs.",
    code: `import { s3Storage } from "@farmjs/core/storage";

export const s3 = s3Storage({
  bucket: process.env.S3_BUCKET!,
  region: process.env.S3_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
});`,
  },
  {
    name: "upstashStorage",
    note: "Hosted Redis over REST for edge-friendly usage.",
    code: `import { upstashStorage } from "@farmjs/core/storage";

export const upstash = upstashStorage({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});`,
  },
  {
    name: "vercelKVStorage",
    note: "Vercel KV helper when running on Vercel infrastructure.",
    code: `import { vercelKVStorage } from "@farmjs/core/storage";

export const kv = vercelKVStorage({});`,
  },
  {
    name: "pgliteStorage",
    note: "PGlite-backed embedded Postgres for local workflows.",
    code: `import { pgliteStorage } from "@farmjs/core/storage";

export const pglite = pgliteStorage({
  dataDir: "./.farm/storage/pglite",
  tableName: "app_store",
});`,
  },
  {
    name: "libsqlStorage",
    note: "libSQL / Turso-compatible SQL-backed storage.",
    code: `import { libsqlStorage } from "@farmjs/core/storage";

export const libsql = libsqlStorage({
  url: process.env.LIBSQL_URL!,
  authToken: process.env.LIBSQL_AUTH_TOKEN!,
  tableName: "app_store",
});`,
  },
] as const;

export default function StorageDocsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Storage</h1>
        <p className="mt-2 text-slate-600">
          Farm.js storage helpers return ready-to-use storage instances. You can call storage
          methods directly and also pass the same instances into <code>farm.config.ts</code>.
        </p>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Core usage</h2>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { sqliteStorage } from "@farmjs/core/storage";

export const sqlite = sqliteStorage({
  path: "./.farm/storage/app.sqlite",
  tableName: "app_store",
});

await sqlite.setItem("settings", { theme: "light" });
const settings = await sqlite.getItem("settings");
await sqlite.removeItem("settings");`}
        </pre>
        <p className="mt-3 text-slate-600">
          The returned object exposes the normal storage API: <code>getItem</code>,
          <code>setItem</code>, <code>setItems</code>, <code>getKeys</code>, <code>removeItem</code>
          ,<code>clear</code>, and <code>dispose</code>.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Mounted stores</h2>
        <p className="mt-2 text-slate-600">
          Mount names are just namespaces. A mount is used when code calls <code>getStorage</code>
          with that namespace.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { defineFarmConfig } from "@farmjs/core";
import { getStorage } from "@farmjs/core/storage";
import { sqliteStorage, redisStorage } from "@farmjs/core/storage";

export const sqlite = sqliteStorage({
  path: "./.farm/storage/app.sqlite",
  tableName: "app_store",
});

export const redis = redisStorage({
  url: process.env.REDIS_URL!,
});

export default defineFarmConfig({
  storage: {
    mounts: {
      app: sqlite,
      ratelimit: redis,
    },
  },
});

const appStore = getStorage("app");
await appStore.setItem("settings", { theme: "light" });

const rateLimitStore = getStorage("ratelimit");
await rateLimitStore.setItem("ip:127.0.0.1", { count: 1 });`}
        </pre>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
          <li>
            <code>app</code> is just a user-defined namespace. It activates when you call{" "}
            <code>getStorage("app")</code>.
          </li>
          <li>
            <code>ratelimit</code> is commonly used by framework rate-limit middleware, so that
            mount can be triggered automatically by Farm internals.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Postgres URL</h2>
        <p className="mt-2 text-slate-600">
          Use a normal Postgres connection string in <code>DATABASE_URL</code>. For Neon or other
          hosted Postgres providers, the URL usually looks like this:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`postgresql://user:password@host:5432/database?sslmode=require`}
        </pre>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { postgresStorage } from "@farmjs/core/storage";

export const pg = postgresStorage({
  url: process.env.DATABASE_URL!,
  tableName: "farm_store",
});`}
        </pre>
        <p className="mt-3 text-slate-600">
          Keep the real URL in an environment variable. Do not hardcode credentials into source
          files or committed tests.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Common helpers</h2>
        <p className="mt-2 text-slate-600">
          The helpers below all return ready-to-use storage instances.
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {helpers.map((helper) => (
            <div key={helper.name} className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-lg font-semibold text-slate-900">{helper.name}</h3>
              <p className="mt-2 text-sm text-slate-600">{helper.note}</p>
              <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
                {helper.code}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">Generic driver escape hatch</h2>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`import { createStorageClient } from "@farmjs/core/storage";

export const custom = createStorageClient({
  driver: "planetscale",
  host: process.env.PLANETSCALE_HOST!,
  username: process.env.PLANETSCALE_USERNAME!,
  password: process.env.PLANETSCALE_PASSWORD!,
  tableName: "app_store",
});`}
        </pre>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-slate-900">What is verified</h2>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-slate-700">
          <li>SQLite persistence across recreated instances.</li>
          <li>Mounted local namespace reads and writes.</li>
          <li>Mounted namespace clear without wiping unrelated root storage.</li>
          <li>Global storage singleton sharing in development.</li>
          <li>DELETE request body parsing for API routes.</li>
          <li>Env-gated Postgres integration using a real database URL.</li>
        </ul>
      </section>

      <nav className="flex gap-4 border-t border-slate-200 pt-8">
        <Link
          href="/docs/api-client"
          className="text-sm font-medium text-emerald-600 hover:underline"
        >
          ← API Client
        </Link>
        <Link href="/docs/layouts" className="text-sm font-medium text-emerald-600 hover:underline">
          Layouts →
        </Link>
      </nav>
    </div>
  );
}
