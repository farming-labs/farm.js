import { createEndpoint, getStorage } from '@farmjs/core';
import path from 'node:path';
import { z } from 'zod';

const backendSchema = z.enum(['local', 'sqlite', 'postgres']);
type StorageDemoBackend = z.infer<typeof backendSchema>;
const STORAGE_DEMO_POSTGRES_URL =
  process.env.DATABASE_URL ??
  process.env.FARM_TEST_POSTGRES_URL ??
  'postgresql://neondb_owner:npg_vjgLO9k0ZHIY@ep-wandering-heart-amad1lvi-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const postgresTableName = 'interactive_storage_demo_pg';

const STORAGE_DEMO_MOUNTS = {
  local: 'storage-demo-local',
  sqlite: 'storage-demo-sqlite',
  postgres: 'storage-demo-postgres',
} as const;

const storageDemoLocations = {
  local: path.join(process.cwd(), '.farm', 'storage-demo', 'local'),
  sqlite: path.join(process.cwd(), '.farm', 'storage-demo', 'interactive.sqlite'),
  postgres: `Postgres table ${postgresTableName}`,
} as const;
const availableBackends = [
  'sqlite',
  'local',
  ...(STORAGE_DEMO_POSTGRES_URL ? ['postgres'] : []),
] as const;

function isBackendAvailable(backend: StorageDemoBackend) {
  return availableBackends.includes(backend);
}

type DemoItem = {
  id: string;
  value: string;
  createdAt: string;
};

function normalizeDemoItem(id: string, raw: unknown): DemoItem {
  if (raw && typeof raw === 'object' && 'value' in raw && 'createdAt' in raw) {
    const value = (raw as { value?: unknown }).value;
    const createdAt = (raw as { createdAt?: unknown }).createdAt;

    return {
      id,
      value: typeof value === 'string' ? value : '',
      createdAt: typeof createdAt === 'string' ? createdAt : '',
    };
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return normalizeDemoItem(id, parsed);
    } catch {
      return {
        id,
        value: raw,
        createdAt: '',
      };
    }
  }

  return {
    id,
    value: '',
    createdAt: '',
  };
}

function resolveDemoStorage(backend: StorageDemoBackend) {
  if (!isBackendAvailable(backend)) {
    throw new Error(
      `Storage backend "${backend}" is not configured. Set DATABASE_URL to enable the Postgres demo.`,
    );
  }

  return getStorage(STORAGE_DEMO_MOUNTS[backend]);
}

async function listItems(backend: StorageDemoBackend) {
  const storage = resolveDemoStorage(backend);
  const keys = (await storage.getKeys()).sort().reverse();
  const items = await Promise.all(
    keys.map(async (id) => normalizeDemoItem(id, await storage.getItem(id))),
  );

  return {
    backend,
    location: storageDemoLocations[backend],
    availableBackends: [...availableBackends],
    items,
    total: items.length,
  };
}

export const GET = createEndpoint(
  '/api/storage-demo',
  {
    method: 'GET',
    query: z.object({
      backend: backendSchema.default('sqlite'),
    }),
  },
  async (ctx) => {
    return listItems(ctx.query.backend as StorageDemoBackend);
  },
);

export const POST = createEndpoint(
  '/api/storage-demo',
  {
    method: 'POST',
    body: z.object({
      backend: backendSchema,
      value: z.string().min(1),
    }),
  },
  async (ctx) => {
    const storage = resolveDemoStorage(ctx.body.backend as StorageDemoBackend);
    const item: DemoItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      value: ctx.body.value,
      createdAt: new Date().toISOString(),
    };

    await storage.setItem(item.id, item);

    return {
      success: true,
      item,
      ...(await listItems(ctx.body.backend as StorageDemoBackend)),
    };
  },
);

export const DELETE = createEndpoint(
  '/api/storage-demo',
  {
    method: 'DELETE',
    body: z.object({
      backend: backendSchema,
      id: z.string().optional(),
      clear: z.boolean().optional(),
    }),
  },
  async (ctx) => {
    const storage = resolveDemoStorage(ctx.body.backend as StorageDemoBackend);

    if (ctx.body.clear) {
      await storage.clear();
    } else if (ctx.body.id) {
      await storage.removeItem(ctx.body.id);
    }

    return {
      success: true,
      ...(await listItems(ctx.body.backend as StorageDemoBackend)),
    };
  },
);
