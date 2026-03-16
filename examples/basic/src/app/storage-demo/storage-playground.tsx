'use client';

import React, { useEffect, useMemo, useState } from 'react';

type StorageBackend = 'sqlite' | 'local' | 'postgres';

type StorageItem = {
  id: string;
  value: string;
  createdAt: string;
};

type StorageResponse = {
  backend: StorageBackend;
  location: string;
  availableBackends: StorageBackend[];
  items: StorageItem[];
  total: number;
};

const backendOptions: Array<{
  value: StorageBackend;
  label: string;
  unavailableLabel?: string;
}> = [
  { value: 'sqlite', label: 'SQLite' },
  { value: 'local', label: 'Local fs-lite' },
  { value: 'postgres', label: 'Postgres', unavailableLabel: 'Set DATABASE_URL' },
];

async function requestStorage<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return response.json();
}

export function StoragePlayground({
  initialAvailableBackends = ['sqlite', 'local'],
}: {
  initialAvailableBackends?: StorageBackend[];
}) {
  const [backend, setBackend] = useState<StorageBackend>('sqlite');
  const [data, setData] = useState<StorageResponse | null>(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locationLabel = useMemo(() => {
    if (data?.location) {
      return data.location;
    }

    if (loading === 'fetch') {
      return 'Loading...';
    }

    if (error) {
      return 'Unavailable';
    }

    return 'Waiting for storage...';
  }, [data, error, loading]);
  const availableBackends = useMemo<StorageBackend[]>(
    () => data?.availableBackends ?? initialAvailableBackends,
    [data, initialAvailableBackends],
  );

  const fetchItems = async (nextBackend: StorageBackend = backend) => {
    setLoading('fetch');
    setError(null);

    try {
      const result = await requestStorage<StorageResponse>(
        `/api/storage-demo?backend=${nextBackend}`,
      );
      setData(result);
      setMessage(`Loaded ${result.total} item(s) from ${nextBackend}.`);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load storage items.');
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    if (!availableBackends.includes(backend)) {
      return;
    }

    void fetchItems(backend);
  }, [backend]);

  const createItem = async () => {
    if (!value.trim()) {
      setError('Enter a value before creating an item.');
      return;
    }

    setLoading('create');
    setError(null);

    try {
      const result = await requestStorage<StorageResponse & { item: StorageItem }>(
        '/api/storage-demo',
        {
          method: 'POST',
          body: JSON.stringify({
            backend,
            value: value.trim(),
          }),
        },
      );
      setData(result);
      setValue('');
      setMessage(`Created item ${result.item.id} in ${backend}. Refresh the page to verify persistence.`);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create item.');
    } finally {
      setLoading(null);
    }
  };

  const deleteItem = async (id: string) => {
    setLoading(`delete:${id}`);
    setError(null);

    try {
      const result = await requestStorage<StorageResponse>('/api/storage-demo', {
        method: 'DELETE',
        body: JSON.stringify({
          backend,
          id,
        }),
      });
      setData(result);
      setMessage(`Deleted ${id} from ${backend}.`);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete item.');
    } finally {
      setLoading(null);
    }
  };

  const clearItems = async () => {
    setLoading('clear');
    setError(null);

    try {
      const result = await requestStorage<StorageResponse>('/api/storage-demo', {
        method: 'DELETE',
        body: JSON.stringify({
          backend,
          clear: true,
        }),
      });
      setData(result);
      setMessage(`Cleared all items from ${backend}.`);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to clear items.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Interactive Persistence</h2>
          <p className="mt-2 max-w-3xl text-slate-600">
            Create, list, delete, and clear items against the mounted storage backend. Refresh the
            page after writes to verify persistence. <code>sqlite</code> and <code>local</code>{' '}
            persist to local disk. <code>postgres</code> appears when <code>DATABASE_URL</code> is
            configured.
          </p>
        </div>
        <div className="flex gap-3">
          {backendOptions.map((option) => {
            const enabled = availableBackends.includes(option.value);
            const isActive = backend === option.value;

            return (
              <button
                key={option.value}
                onClick={() => enabled && setBackend(option.value)}
                disabled={!enabled}
                title={!enabled ? option.unavailableLabel : undefined}
                className={`rounded-lg px-4 py-2 text-sm font-medium ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : enabled
                      ? 'border border-slate-300 bg-white text-slate-700'
                      : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">Current backend</p>
            <p className="mt-1 text-sm text-slate-600">{backend}</p>
            <p className="mt-3 text-sm font-medium text-slate-900">Persistence path</p>
            <code className="mt-1 block overflow-x-auto rounded bg-slate-950 px-3 py-2 text-xs text-slate-100">
              {locationLabel}
            </code>
            {!availableBackends.includes('postgres') && (
              <p className="mt-3 text-xs text-slate-500">
                Set <code>DATABASE_URL</code> to enable the Postgres playground backend.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="block text-sm font-medium text-slate-900" htmlFor="storage-value">
              New value
            </label>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                id="storage-value"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={`Write something into ${backend}`}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-slate-500"
              />
              <button
                onClick={createItem}
                disabled={loading === 'create'}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {loading === 'create' ? 'Creating...' : 'Create'}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                onClick={() => fetchItems()}
                disabled={loading === 'fetch'}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Refresh
              </button>
              <button
                onClick={clearItems}
                disabled={loading === 'clear' || (data?.total ?? 0) === 0}
                className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                {loading === 'clear' ? 'Clearing...' : 'Clear All'}
              </button>
            </div>
          </div>

          {message && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              {message}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Stored Items</h3>
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
              {data?.total ?? 0}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {data?.items.length ? (
              data.items.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{item.value}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.id}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteItem(item.id)}
                      disabled={loading === `delete:${item.id}`}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                    >
                      {loading === `delete:${item.id}` ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                No items yet. Create one, refresh the page, and confirm it stays there.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
