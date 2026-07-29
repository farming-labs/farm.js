'use client';

import { Link } from "@farm.js/core/client";
import { StoragePlayground } from "./storage-playground";

type HelperSnippet = {
  title: string;
  note: string;
  code: string;
};

const helperSnippets: HelperSnippet[] = [
  {
    title: "postgresStorage",
    note: "Programmatic Postgres client you can use directly or mount in farm.config.",
    code: `import { postgresStorage } from "@farm.js/core/storage";

export const pg = postgresStorage({
  url: process.env.DATABASE_URL!,
  tableName: "session_store",
});`,
  },
  {
    title: "mysqlStorage",
    note: "MySQL helper backed by db0 + unstorage db0 driver.",
    code: `import { mysqlStorage } from "@farm.js/core/storage";

export const mysql = mysqlStorage({
  host: process.env.MYSQL_HOST!,
  user: process.env.MYSQL_USER!,
  password: process.env.MYSQL_PASSWORD!,
  database: process.env.MYSQL_DATABASE!,
  tableName: "session_store",
});`,
  },
  {
    title: "redisStorage",
    note: "Redis helper for rate limits, cache, and short-lived state.",
    code: `import { redisStorage } from "@farm.js/core/storage";

export const redis = redisStorage({
  url: process.env.REDIS_URL!,
});`,
  },
  {
    title: "mongodbStorage",
    note: "MongoDB helper using the unstorage mongodb driver.",
    code: `import { mongodbStorage } from "@farm.js/core/storage";

export const mongo = mongodbStorage({
  connectionString: process.env.MONGO_URL!,
  databaseName: "app",
  collectionName: "storage",
});`,
  },
  {
    title: "s3Storage",
    note: "S3 helper for bucket-backed key-value storage.",
    code: `import { s3Storage } from "@farm.js/core/storage";

export const s3 = s3Storage({
  bucket: process.env.S3_BUCKET!,
  region: process.env.S3_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
});`,
  },
  {
    title: "upstashStorage / vercelKVStorage",
    note: "Edge-friendly hosted key-value helpers.",
    code: `import { upstashStorage, vercelKVStorage } from "@farm.js/core/storage";

export const upstash = upstashStorage({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const vercelKV = vercelKVStorage({});`,
  },
];

const previewKinds = {
  redisKind: "farm-storage-client",
  postgresKind: "farm-storage-client",
  mysqlKind: "farm-storage-client",
  mongoKind: "farm-storage-client",
  s3Kind: "farm-storage-client",
  upstashKind: "farm-storage-client",
  vercelKVKind: "farm-storage-client",
  sqliteKind: "farm-storage-client",
};

export default function StorageDemoPage() {
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900">Storage Demo</h1>
        <p className="mt-3 max-w-3xl text-slate-600">
          Storage helpers return ready-to-use instances. You can call storage methods directly on
          them and also pass the same instances into <code>farm.config.ts</code>.
        </p>
        <pre className="mt-6 overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm text-slate-100">
{`import { sqliteStorage, redisStorage } from "@farm.js/core/storage";

export const sqlite = sqliteStorage({
  path: "./.farm/app.sqlite",
  tableName: "app_store",
});

export const redis = redisStorage({
  url: process.env.REDIS_URL!,
});

await sqlite.setItem("settings", { theme: "light" });

export default defineConfig({
  storage: {
    mounts: {
      app: sqlite,
      ratelimit: redis,
    },
  },
});`}
        </pre>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            title: "SQLite persistence",
            detail:
              "Create items, refresh, and verify they remain in .farm/storage-demo/interactive.sqlite.",
          },
          {
            title: "Local fs-lite persistence",
            detail:
              "Switch to Local fs-lite, create items, and verify they remain in .farm/storage-demo/local.",
          },
          {
            title: "Interactive verification",
            detail:
              "The playground below lets you create, delete, clear, and refresh so you can verify persistence yourself.",
          },
          {
            title: "Optional Postgres backend",
            detail:
              "When DATABASE_URL is configured, the same playground exposes a Postgres-backed store alongside SQLite and local fs-lite.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-2xl border border-sky-200 bg-sky-50 p-5 shadow-sm"
          >
            <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
            <p className="mt-3 text-sm text-slate-700">{item.detail}</p>
          </div>
        ))}
      </div>

      <StoragePlayground />

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Common Helpers</h2>
        <p className="mt-2 text-slate-600">
          These helpers are created programmatically and expose the storage API directly. Remote
          backends still need valid credentials at runtime.
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {helperSnippets.map((snippet) => (
            <div key={snippet.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="text-lg font-semibold text-slate-900">{snippet.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{snippet.note}</p>
              <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm text-slate-100">
                {snippet.code}
              </pre>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Preview Instances</h2>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm text-slate-100">
          {JSON.stringify(previewKinds, null, 2)}
        </pre>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/"
          className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Back Home
        </Link>
        <Link
          href="/api-demo-client-advanced"
          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          API Client Demo
        </Link>
      </div>
    </div>
  );
}
