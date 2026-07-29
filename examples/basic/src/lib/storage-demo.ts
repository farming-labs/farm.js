import path from 'node:path';
import { localStorage, postgresStorage, sqliteStorage } from '@farm.js/core/storage';

export const STORAGE_DEMO_POSTGRES_URL =
  process.env.DATABASE_URL ??
  process.env.FARM_TEST_POSTGRES_URL ??
  'postgresql://neondb_owner:npg_vjgLO9k0ZHIY@ep-wandering-heart-amad1lvi-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

export const STORAGE_DEMO_MOUNTS = {
  local: 'storage-demo-local',
  sqlite: 'storage-demo-sqlite',
  postgres: 'storage-demo-postgres',
} as const;

export type StorageDemoBackend = keyof typeof STORAGE_DEMO_MOUNTS;

const baseDir = path.join(process.cwd(), '.farm', 'storage-demo');
const postgresTableName = 'interactive_storage_demo_pg';

export const storageDemoLocations = {
  local: path.join(baseDir, 'local'),
  sqlite: path.join(baseDir, 'interactive.sqlite'),
  postgres: `Postgres table ${postgresTableName}`,
} as const;

export const storageDemoClients = {
  local: localStorage({
    base: storageDemoLocations.local,
  }),
  sqlite: sqliteStorage({
    path: storageDemoLocations.sqlite,
    tableName: 'interactive_storage_demo',
  }),
  ...(STORAGE_DEMO_POSTGRES_URL
    ? {
        postgres: postgresStorage({
          url: STORAGE_DEMO_POSTGRES_URL,
          tableName: postgresTableName,
        }),
      }
    : {}),
} as const;

export const storageDemoAvailableBackends: readonly StorageDemoBackend[] = [
  'sqlite',
  'local',
  ...(STORAGE_DEMO_POSTGRES_URL ? (['postgres'] as const) : []),
];

export function getStorageDemoMount(backend: StorageDemoBackend) {
  return STORAGE_DEMO_MOUNTS[backend];
}
